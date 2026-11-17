import { PASSWORD_RESET_TTL_MS } from '../domain/password-reset.policy';
import {
  accountEmailOwner,
  isAccountEmailPurpose,
  type AccountEmailPurpose,
} from '../../email/account-email-policy';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { IdentityEmailDelivery } from '@prisma/client';
import type { ICryptoProvider } from '../../../contracts';
import { CRYPTO_PROVIDER } from '../../../providers';
import { PrismaService } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { HashHelper } from '../../../helpers/foundation.helpers';
import { generateUuidV7 } from '../../../utils';
import type { IdentityTokenPurpose } from '../domain/identity.types';

export const IDENTITY_EMAIL_MAX_ATTEMPTS = 6;
export const IDENTITY_EMAIL_LEASE_MS = 5 * 60_000;
export interface IdentityEmailInput {
  purpose: IdentityTokenPurpose | AccountEmailPurpose;
  recipient: string;
  token: string;
  expiresAt: Date;
  userId?: string;
  organizationId?: string;
  data?: Record<string, unknown>;
}
export type ClaimedIdentityEmail = IdentityEmailDelivery & { leaseId: string };

/** Identity is global; its own RLS outbox also handles recovery before login. */
@Injectable()
export class IdentityEmailOutbox {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CRYPTO_PROVIDER) private readonly crypto: ICryptoProvider,
  ) {}

  async enqueueIn(tx: PrismaTransactionClient, input: IdentityEmailInput) {
    if (input.purpose === 'INVITATION' || !input.userId) return;
    const owner = await accountEmailOwner(tx, input.userId);
    if (
      !owner ||
      owner.email.trim().toLowerCase() !== input.recipient.trim().toLowerCase()
    )
      return;
    const id = generateUuidV7();
    // Bind ciphertext to the row identity and immutable routing metadata.
    const encryptedPayload = this.crypto.encrypt(
      JSON.stringify({
        id,
        purpose: input.purpose,
        recipient: input.recipient,
        token: input.token,
        data: input.data ?? {},
        userId: input.userId ?? null,
        organizationId: input.organizationId ?? null,
        expiresAt: input.expiresAt.toISOString(),
      }),
    );
    // INSERT only: normal requests cannot SELECT the outbox, even their own rows.
    await tx.identityEmailDelivery.createMany({
      data: {
        id,
        purpose: input.purpose,
        userId: input.userId,
        organizationId: input.organizationId,
        tokenHash: HashHelper.sha256(input.token),
        encryptedPayload,
        expiresAt: input.expiresAt,
      },
      skipDuplicates: true,
    });
  }

  /** Called INSIDE registration/member creation, so neither fact can be lost. */
  async welcomeIn(tx: PrismaTransactionClient, userId: string, email: string) {
    if (!(await accountEmailOwner(tx, userId))) return;
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60_000);
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    await tx.emailVerificationToken.create({
      data: {
        userId,
        email: email.trim().toLowerCase(),
        tokenHash: HashHelper.sha256(token),
        expiresAt,
      },
    });
    await this.enqueueIn(tx, {
      purpose: 'EMAIL_VERIFICATION',
      data: { welcome: true },
      userId,
      recipient: email,
      token,
      expiresAt,
    });
  }

  async canQueueIdentityIn(
    tx: PrismaTransactionClient,
    userId: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'account-email:' + userId},0))::text`;
    const [context] = await tx.$queryRaw<
      { previous: string | null }[]
    >`SELECT current_setting('app.identity_email_worker',true) AS previous`;
    await tx.$queryRaw`SELECT set_config('app.identity_email_worker','true',true)`;
    try {
      return (
        (await tx.identityEmailDelivery.count({
          where: {
            userId,
            purpose,
            createdAt: { gte: new Date(Date.now() - 86400000) },
          },
        })) < 5
      );
    } finally {
      await tx.$queryRaw`SELECT set_config('app.identity_email_worker',${context?.previous ?? ''},true)`;
    }
  }
  async enqueueNoticeIn(
    tx: PrismaTransactionClient,
    userId: string,
    purpose: AccountEmailPurpose,
    eventKey: string,
    data: Record<string, unknown> = {},
  ) {
    const owner = await accountEmailOwner(tx, userId);
    if (!owner || (purpose !== 'PASSWORD_CHANGED' && !owner.verifiedAt)) return;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'account-email:' + userId},0))::text`;
    const [context] = await tx.$queryRaw<
      { previous: string | null }[]
    >`SELECT current_setting('app.identity_email_worker',true) AS previous`;
    await tx.$queryRaw`SELECT set_config('app.identity_email_worker','true',true)`;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60_000);
      const recent = await tx.identityEmailDelivery.count({
        where: {
          userId,
          purpose: {
            in:
              purpose === 'PASSWORD_CHANGED'
                ? ['PASSWORD_CHANGED']
                : ['PLAN_EXPIRED', 'PLAN_LIMIT_REACHED'],
          },
          createdAt: { gte: since },
        },
      });
      if (recent >= (purpose === 'PASSWORD_CHANGED' ? 5 : 2)) return;
      const last = await tx.identityEmailDelivery.findFirst({
        where: {
          userId,
          purpose,
          createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
        },
        select: { id: true },
      });
      if (last) return;
      const token = HashHelper.sha256(`${purpose}:${userId}:${eventKey}`);
      await this.enqueueIn(tx, {
        purpose,
        userId,
        recipient: owner.email,
        token,
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        data,
      });
    } finally {
      await tx.$queryRaw`SELECT set_config('app.identity_email_worker',${context?.previous ?? ''},true)`;
    }
  }

  private asWorker<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.identity_email_worker', 'true', true)`;
      return work(tx);
    });
  }

  async claim(): Promise<ClaimedIdentityEmail | null> {
    return this.asWorker(async (tx) => {
      const leaseId = generateUuidV7();
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE identity_email_deliveries
        SET status='RUNNING', attempts=attempts+1, locked_at=now(), lease_id=${leaseId}::uuid, updated_at=now()
        WHERE id=(SELECT id FROM identity_email_deliveries
          WHERE (status='PENDING' AND available_at<=now())
             OR (status='RUNNING' AND locked_at < now() - ${IDENTITY_EMAIL_LEASE_MS} * interval '1 millisecond')
          ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`;
      if (!rows[0]) return null;
      return tx.identityEmailDelivery.findUniqueOrThrow({
        where: { id: rows[0].id },
      }) as Promise<ClaimedIdentityEmail>;
    });
  }

  decrypt(row: ClaimedIdentityEmail): {
    recipient: string;
    token: string;
    data: Record<string, unknown>;
  } {
    const data = JSON.parse(
      this.crypto.decrypt(row.encryptedPayload!),
    ) as Record<string, unknown>;
    if (
      data.id !== row.id ||
      data.purpose !== row.purpose ||
      data.userId !== row.userId ||
      data.organizationId !== row.organizationId ||
      data.expiresAt !== row.expiresAt.toISOString() ||
      typeof data.recipient !== 'string' ||
      typeof data.token !== 'string' ||
      HashHelper.sha256(data.token) !== row.tokenHash
    )
      throw new Error('IDENTITY_EMAIL_PAYLOAD_INVALID');
    return {
      recipient: data.recipient,
      token: data.token,
      data:
        data.data && typeof data.data === 'object' && !Array.isArray(data.data)
          ? (data.data as Record<string, unknown>)
          : {},
    };
  }

  /** Fresh authority immediately before every provider attempt, never a frozen claim. */
  eligible(row: ClaimedIdentityEmail, recipient: string): Promise<boolean> {
    if (row.expiresAt.getTime() <= Date.now()) return Promise.resolve(false);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${row.userId ?? ''}, true),
        set_config('app.organization_id', ${row.organizationId ?? ''}, true)`;
      const live = { tokenHash: row.tokenHash, expiresAt: { gt: new Date() } };
      if (row.purpose === 'INVITATION' || !row.userId) return false;
      const owner = await accountEmailOwner(tx, row.userId);
      if (
        !owner ||
        owner.email.trim().toLowerCase() !== recipient.trim().toLowerCase()
      )
        return false;
      if (isAccountEmailPurpose(row.purpose)) return true;
      const user = await tx.user.findFirst({
        where: {
          id: row.userId,
          normalizedEmail: recipient.trim().toLowerCase(),
          status: 'ACTIVE',
          deletedAt: null,
          ...(row.purpose === 'EMAIL_VERIFICATION'
            ? { emailVerifiedAt: null }
            : { credential: { isNot: null } }),
        },
        select: { id: true },
      });
      if (!user) return false;
      if (row.purpose === 'EMAIL_VERIFICATION')
        return !!(await tx.emailVerificationToken.findFirst({
          where: {
            ...live,
            userId: user.id,
            usedAt: null,
            email: recipient.trim().toLowerCase(),
          },
          select: { id: true },
        }));
      return !!(await tx.passwordResetToken.findFirst({
        where: {
          ...live,
          userId: user.id,
          usedAt: null,
          createdAt: { gt: new Date(Date.now() - PASSWORD_RESET_TTL_MS) },
        },
        select: { id: true },
      }));
    });
  }

  finish(
    row: ClaimedIdentityEmail,
    status: 'PENDING' | 'ACCEPTED_BY_PROVIDER' | 'SKIPPED' | 'FAILED',
    code: string | null = null,
    messageId?: string,
    availableAt?: Date,
  ) {
    return this.asWorker((tx) =>
      tx.identityEmailDelivery.updateMany({
        // Fencing prevents a stalled replica from overwriting the replacement lease.
        where: { id: row.id, leaseId: row.leaseId, status: 'RUNNING' },
        data: {
          status,
          lockedAt: null,
          leaseId: null,
          availableAt,
          encryptedPayload: status === 'PENDING' ? undefined : null,
          lastErrorCode: code && /^[A-Z0-9_]{1,80}$/.test(code) ? code : null,
          providerMessageId: messageId?.slice(0, 255),
          finishedAt: status === 'PENDING' ? null : new Date(),
        },
      }),
    );
  }
}
