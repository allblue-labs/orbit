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
  purpose: IdentityTokenPurpose;
  recipient: string;
  token: string;
  expiresAt: Date;
  userId?: string;
  organizationId?: string;
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
    const id = generateUuidV7();
    // Bind ciphertext to the row identity and immutable routing metadata.
    const encryptedPayload = this.crypto.encrypt(
      JSON.stringify({
        id,
        purpose: input.purpose,
        recipient: input.recipient,
        token: input.token,
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
      userId,
      recipient: email,
      token,
      expiresAt,
    });
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

  decrypt(row: ClaimedIdentityEmail): { recipient: string; token: string } {
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
    return { recipient: data.recipient, token: data.token };
  }

  /** Fresh authority immediately before every provider attempt, never a frozen claim. */
  eligible(row: ClaimedIdentityEmail, recipient: string): Promise<boolean> {
    if (row.expiresAt.getTime() <= Date.now()) return Promise.resolve(false);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${row.userId ?? ''}, true),
        set_config('app.organization_id', ${row.organizationId ?? ''}, true)`;
      const live = { tokenHash: row.tokenHash, expiresAt: { gt: new Date() } };
      if (row.purpose === 'INVITATION') {
        return !!(await tx.identityInvitation.findFirst({
          where: {
            ...live,
            organizationId: row.organizationId!,
            status: 'PENDING',
            normalizedEmail: recipient.trim().toLowerCase(),
            organization: { deletedAt: null, status: 'ACTIVE' },
          },
          select: { id: true },
        }));
      }
      const user = await tx.user.findFirst({
        where: {
          id: row.userId!,
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
        where: { ...live, userId: user.id, usedAt: null },
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
