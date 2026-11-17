import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { PublicContactSubmission } from '@prisma/client';
import { PrismaService } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { CRYPTO_PROVIDER } from '../../providers';
import type { ICryptoProvider } from '../../contracts';
import {
  ConflictException,
  InfrastructureException,
  RateLimitException,
} from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import type { PublicContactDto } from './public-contact.dto';

export type ContactClaim = PublicContactSubmission & { leaseId: string };
export const CONTACT_LEASE_MS = 5 * 60_000;
@Injectable()
export class PublicContactRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CRYPTO_PROVIDER) private readonly crypto: ICryptoProvider,
  ) {}
  private hash(scope: string, value: unknown) {
    const secret = process.env.AUTH_RATE_LIMIT_SECRET ?? '';
    if (secret.length < 32)
      throw new InfrastructureException('Contact rate-limit secret is missing');
    return createHmac('sha256', secret)
      .update(JSON.stringify(['public-contact-v1', scope, value]))
      .digest('hex');
  }
  async enqueue(
    input: PublicContactDto,
    key: string,
    origin: string,
    recipient: string,
  ) {
    const requestKey = this.hash('request', [key, input.email]);
    const content = {
      name: input.name,
      email: input.email,
      topic: input.topic,
      message: input.message,
      recipient,
    };
    const payloadHash = this.hash('payload', content);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.public_contact_key',${requestKey},true)`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contact:${requestKey}`},0))::text`;
      const previous = await tx.publicContactSubmission.findUnique({
        where: { requestKey },
      });
      if (previous) {
        if (previous.payloadHash !== payloadHash)
          throw new ConflictException(
            'Esta tentativa já corresponde a outra mensagem. Envie novamente.',
            'PUBLIC_CONTACT_CONFLICT',
          );
        return;
      }
      // Serialize this small public intake before taking rate-limit shard locks.
      // It makes the rolling daily ceiling atomic across API replicas too.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('public-contact-daily-budget',0))::text`;
      await tx.$queryRaw`SELECT set_config('app.public_contact_worker','true',true)`;
      const [daily] = await tx.$queryRaw<{ total: number; retry: number }[]>`
        SELECT count(*)::int AS total,
          greatest(1,ceil(extract(epoch FROM (min(created_at)+interval '24 hours'-clock_timestamp()))))::int AS retry
        FROM public_contact_submissions WHERE created_at>clock_timestamp()-interval '24 hours'`;
      await tx.$queryRaw`SELECT set_config('app.public_contact_worker','false',true)`;
      if (!daily || daily.total >= 100)
        throw new RateLimitException(daily?.retry ?? 3600);
      for (const budget of [
        { scope: 'origin', value: origin, max: 5, window: 3_600_000 },
        { scope: 'email', value: input.email, max: 3, window: 3_600_000 },
      ]) {
        const hash = this.hash(budget.scope, budget.value);
        const [result] = await tx.$queryRaw<
          { allowed: boolean; retry: number }[]
        >`SELECT allowed,retry_after_seconds AS retry FROM app_auth_rate_limit_consume(${hash},${budget.max},${budget.window})`;
        if (!result?.allowed)
          throw new RateLimitException(result?.retry ?? 3600);
      }
      const id = generateUuidV7();
      await tx.publicContactSubmission.create({
        data: {
          id,
          requestKey,
          payloadHash,
          encryptedPayload: this.crypto.encrypt(
            JSON.stringify({ id, ...content }),
          ),
          expiresAt: new Date(Date.now() + 7 * 86_400_000 - 1000),
        },
      });
    });
  }
  private asWorker<T>(work: (tx: PrismaTransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.public_contact_worker','true',true)`;
      return work(tx);
    });
  }
  claim() {
    return this.asWorker(async (tx) => {
      const leaseId = generateUuidV7();
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        UPDATE public_contact_submissions SET status='RUNNING',attempts=attempts+1,locked_at=now(),lease_id=${leaseId}::uuid,updated_at=now()
        WHERE id=(SELECT id FROM public_contact_submissions
          WHERE (status='PENDING' AND available_at<=now()) OR (status='RUNNING' AND locked_at<now()-${CONTACT_LEASE_MS}*interval '1 millisecond')
          ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`;
      return row
        ? (tx.publicContactSubmission.findUniqueOrThrow({
            where: { id: row.id },
          }) as Promise<ContactClaim>)
        : null;
    });
  }
  decrypt(row: ContactClaim): PublicContactDto & { recipient: string } {
    const content = JSON.parse(
      this.crypto.decrypt(row.encryptedPayload!),
    ) as Record<string, unknown>;
    if (
      content.id !== row.id ||
      typeof content.name !== 'string' ||
      typeof content.email !== 'string' ||
      !['SUPPORT', 'FEEDBACK', 'QUESTION'].includes(String(content.topic)) ||
      typeof content.message !== 'string' ||
      typeof content.recipient !== 'string'
    )
      throw new Error('CONTACT_PAYLOAD_INVALID');
    const data = {
      name: content.name,
      email: content.email,
      topic: content.topic,
      message: content.message,
      recipient: content.recipient,
    };
    if (this.hash('payload', data) !== row.payloadHash)
      throw new Error('CONTACT_PAYLOAD_INVALID');
    return data as unknown as PublicContactDto & { recipient: string };
  }
  finish(
    row: ContactClaim,
    status: 'PENDING' | 'ACCEPTED' | 'FAILED' | 'SKIPPED',
    availableAt = new Date(),
  ) {
    return this.asWorker((tx) =>
      tx.publicContactSubmission.updateMany({
        where: { id: row.id, leaseId: row.leaseId, status: 'RUNNING' },
        data: {
          status,
          availableAt,
          leaseId: null,
          lockedAt: null,
          ...(status === 'PENDING' ? {} : { encryptedPayload: null }),
          ...(status === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
        },
      }),
    );
  }
  prune() {
    return this.asWorker((tx) =>
      tx.publicContactSubmission.deleteMany({
        where: {
          status: { in: ['ACCEPTED', 'FAILED', 'SKIPPED'] },
          createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) },
        },
      }),
    );
  }
}
