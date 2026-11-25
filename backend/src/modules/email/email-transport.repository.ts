import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { PrismaService } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import {
  SES_FEEDBACK_CONFIGURATION,
  emailSuppressionHashKey,
  type SesFeedbackConfiguration,
} from './ses-feedback.config';
import { SesFeedbackError, type SesFeedback } from './ses-feedback.types';

export interface FeedbackIdentity {
  topicArn: string;
  messageId: string;
  payloadHash: string;
}
export const normalizeEmail = (address: string) => address.trim().toLowerCase();

/** Dedicated context opens only the email tables, never tenant business data. */
@Injectable()
export class EmailTransportRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SES_FEEDBACK_CONFIGURATION)
    private readonly config: SesFeedbackConfiguration,
  ) {}

  hash(address: string): string {
    const key = emailSuppressionHashKey(this.config.hashKey);
    return createHmac('sha256', key)
      .update(`email-address-v1\0${normalizeEmail(address)}`)
      .digest('hex');
  }
  private transaction<T>(work: (tx: PrismaTransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.email_transport','true',true)`;
      return work(tx);
    });
  }
  private async lock(tx: PrismaTransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))`;
  }
  async prepare(
    to: string,
    from: string,
    region: string,
    identityDeliveryId?: string,
    contactSubmissionId?: string,
  ): Promise<string | null> {
    const recipientHash = this.hash(to);
    return this.transaction(async (tx) => {
      await this.lock(tx, `email-recipient:${recipientHash}`);
      if (await tx.emailSuppression.findUnique({ where: { recipientHash } }))
        return null;
      const row = await tx.emailOutboundMessage.create({
        data: {
          id: generateUuidV7(),
          region,
          sourceHash: this.hash(from),
          recipientHashes: [recipientHash],
          identityDeliveryId,
          contactSubmissionId,
        },
      });
      return row.id;
    });
  }
  acceptedDelivery(
    identityDeliveryId: string,
    to: string,
    from: string,
    region: string,
  ) {
    return this.transaction(async (tx) => {
      const message = await tx.emailOutboundMessage.findFirst({
        where: {
          identityDeliveryId,
          region,
          status: 'ACCEPTED',
          sourceHash: this.hash(from),
          recipientHashes: { equals: [this.hash(to)] },
        },
        orderBy: { createdAt: 'asc' },
        include: { providerMessages: { take: 1 } },
      });
      return (
        message?.providerMessageId ??
        message?.providerMessages[0]?.providerMessageId ??
        null
      );
    });
  }
  acceptedContactDelivery(
    contactSubmissionId: string,
    to: string,
    from: string,
    region: string,
  ) {
    return this.transaction(async (tx) => {
      const message = await tx.emailOutboundMessage.findFirst({
        where: {
          contactSubmissionId,
          region,
          status: 'ACCEPTED',
          sourceHash: this.hash(from),
          recipientHashes: { equals: [this.hash(to)] },
        },
        orderBy: { createdAt: 'asc' },
        include: { providerMessages: { take: 1 } },
      });
      return (
        message?.providerMessageId ??
        message?.providerMessages[0]?.providerMessageId ??
        null
      );
    });
  }
  accepted(id: string, providerMessageId: string) {
    return this.transaction(async (tx) => {
      const { region } = await tx.emailOutboundMessage.findUniqueOrThrow({
        where: { id },
        select: { region: true },
      });
      await this.lock(tx, `email-provider:${region}:${providerMessageId}`);
      await this.lock(tx, `email-outbound:${id}`);
      const row = await tx.emailOutboundMessage.findUniqueOrThrow({
        where: { id },
      });
      await this.bindProvider(tx, id, region, providerMessageId);
      await tx.emailOutboundMessage.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          providerMessageId,
          acceptedAt: row.acceptedAt ?? new Date(),
        },
      });
    });
  }
  private async bindProvider(
    tx: PrismaTransactionClient,
    outboundId: string,
    region: string,
    providerMessageId: string,
  ) {
    await tx.emailProviderMessage.createMany({
      data: { outboundId, region, providerMessageId },
      skipDuplicates: true,
    });
    const binding = await tx.emailProviderMessage.findUniqueOrThrow({
      where: { region_providerMessageId: { region, providerMessageId } },
    });
    if (binding.outboundId !== outboundId)
      throw new SesFeedbackError('SES_MESSAGE_BINDING_CONFLICT', 409);
  }
  failed(id: string, retryable: boolean) {
    return this.transaction((tx) =>
      tx.emailOutboundMessage.updateMany({
        where: { id, providerMessageId: null, status: 'PREPARED' },
        data: { status: retryable ? 'UNKNOWN' : 'FAILED' },
      }),
    );
  }
  private async previous(tx: PrismaTransactionClient, input: FeedbackIdentity) {
    await this.lock(tx, `ses-feedback:${input.topicArn}:${input.messageId}`);
    const row = await tx.emailFeedbackEvent.findUnique({
      where: {
        topicArn_snsMessageId: {
          topicArn: input.topicArn,
          snsMessageId: input.messageId,
        },
      },
    });
    if (row && row.payloadHash !== input.payloadHash)
      throw new SesFeedbackError('SNS_MESSAGE_ID_COLLISION', 409);
    return row;
  }

  apply(input: FeedbackIdentity, feedback: SesFeedback) {
    return this.transaction(async (tx) => {
      if (await this.previous(tx, input)) return { duplicate: true };
      await this.lock(
        tx,
        `email-provider:${this.config.region}:${feedback.sesMessageId}`,
      );
      const binding = await tx.emailProviderMessage.findUnique({
        where: {
          region_providerMessageId: {
            region: this.config.region,
            providerMessageId: feedback.sesMessageId,
          },
        },
        include: { outbound: true },
      });
      const byMessage = binding?.outbound;
      const byTag = feedback.outboundId
        ? await tx.emailOutboundMessage.findUnique({
            where: { id: feedback.outboundId },
          })
        : null;
      if (
        byMessage &&
        feedback.outboundId &&
        byMessage.id !== feedback.outboundId
      )
        throw new SesFeedbackError('SES_MESSAGE_BINDING_CONFLICT', 409);
      const known = byMessage ?? byTag;
      // The provider can report before SendEmail returns, or after a sender crash.
      // Retry unassociated notifications; never ACK them and silently lose suppression.
      if (!known)
        throw new SesFeedbackError('SES_DELIVERY_NOT_YET_ASSOCIATED', 503);
      await this.lock(tx, `email-outbound:${known.id}`);
      const row = await tx.emailOutboundMessage.findUniqueOrThrow({
        where: { id: known.id },
      });
      if (
        row.region !== this.config.region ||
        row.sourceHash !== this.hash(feedback.source)
      )
        throw new SesFeedbackError('SES_SOURCE_MISMATCH', 403);
      const destination = [
        ...new Set(feedback.destination.map((address) => this.hash(address))),
      ].sort();
      const expected = [...new Set(row.recipientHashes)].sort();
      const recipients = [
        ...new Set(feedback.recipients.map((address) => this.hash(address))),
      ].sort();
      if (
        JSON.stringify(destination) !== JSON.stringify(expected) ||
        recipients.some((hash) => !expected.includes(hash))
      )
        throw new SesFeedbackError('SES_RECIPIENT_MISMATCH', 403);
      await this.bindProvider(tx, row.id, row.region, feedback.sesMessageId);
      for (const hash of recipients)
        await this.lock(tx, `email-recipient:${hash}`);
      const event = await tx.emailFeedbackEvent.create({
        data: {
          id: generateUuidV7(),
          topicArn: input.topicArn,
          snsMessageId: input.messageId,
          payloadHash: input.payloadHash,
          kind: feedback.kind,
          outboundId: row.id,
          recipientHashes: recipients,
          occurredAt: feedback.occurredAt,
        },
      });
      if (feedback.kind === 'HARD_BOUNCE' || feedback.kind === 'COMPLAINT') {
        for (const recipientHash of recipients) {
          const old = await tx.emailSuppression.findUnique({
            where: { recipientHash },
          });
          await tx.emailSuppression.upsert({
            where: { recipientHash },
            create: {
              recipientHash,
              reason: feedback.kind,
              feedbackEventId: event.id,
            },
            update: {
              reason: old?.reason === 'COMPLAINT' ? 'COMPLAINT' : feedback.kind,
              feedbackEventId:
                old?.reason === 'COMPLAINT' ? old.feedbackEventId : event.id,
              lastObservedAt: new Date(),
            },
          });
        }
      }
      const priority: Record<string, number> = {
        UNOBSERVED: 0,
        SOFT_BOUNCE: 1,
        DELIVERY: 2,
        HARD_BOUNCE: 3,
        COMPLAINT: 4,
      };
      const feedbackStatus =
        feedback.kind !== 'IGNORED' &&
        priority[feedback.kind]! > priority[row.feedbackStatus]!
          ? feedback.kind
          : row.feedbackStatus;
      await tx.emailOutboundMessage.update({
        where: { id: row.id },
        data: {
          status: 'ACCEPTED',
          acceptedAt: row.acceptedAt ?? new Date(),
          feedbackStatus,
        },
      });
      return { duplicate: false };
    });
  }

  claimConfirmation(input: FeedbackIdentity) {
    return this.transaction(async (tx) => {
      let row = await this.previous(tx, input);
      if (row?.status === 'PROCESSED') return null;
      row ??= await tx.emailFeedbackEvent.create({
        data: {
          id: generateUuidV7(),
          topicArn: input.topicArn,
          snsMessageId: input.messageId,
          payloadHash: input.payloadHash,
          kind: 'SUBSCRIPTION_CONFIRMATION',
          recipientHashes: [],
          status: 'PENDING',
        },
      });
      const leaseId = generateUuidV7();
      const claimed = await tx.$queryRaw<
        { id: string }[]
      >`UPDATE email_feedback_events SET status='PROCESSING',lease_id=${leaseId}::uuid,lease_expires_at=now()+interval '60 seconds',updated_at=now() WHERE id=${row.id}::uuid AND (status='PENDING' OR (status='PROCESSING' AND lease_expires_at<=now())) RETURNING id`;
      if (!claimed.length)
        throw new SesFeedbackError('SNS_CONFIRMATION_IN_PROGRESS', 503);
      return { id: row.id, leaseId };
    });
  }
  finishConfirmation(
    claim: { id: string; leaseId: string },
    subscriptionArn: string,
  ) {
    return this.transaction(async (tx) => {
      const count =
        await tx.$executeRaw`UPDATE email_feedback_events SET status='PROCESSED',lease_id=NULL,lease_expires_at=NULL,subscription_arn=${subscriptionArn},updated_at=now() WHERE id=${claim.id}::uuid AND lease_id=${claim.leaseId}::uuid AND status='PROCESSING' AND lease_expires_at>now()`;
      if (count !== 1)
        throw new SesFeedbackError('SNS_CONFIRMATION_LEASE_LOST', 503);
    });
  }
  releaseConfirmation(claim: { id: string; leaseId: string }) {
    return this.transaction((tx) =>
      tx.emailFeedbackEvent.updateMany({
        where: { id: claim.id, leaseId: claim.leaseId, status: 'PROCESSING' },
        data: { status: 'PENDING', leaseId: null, leaseExpiresAt: null },
      }),
    );
  }
  recordUnsubscribe(input: FeedbackIdentity) {
    return this.transaction(async (tx) => {
      if (await this.previous(tx, input)) return { duplicate: true };
      await tx.emailFeedbackEvent.create({
        data: {
          id: generateUuidV7(),
          topicArn: input.topicArn,
          snsMessageId: input.messageId,
          payloadHash: input.payloadHash,
          kind: 'UNSUBSCRIBE_CONFIRMATION',
          recipientHashes: [],
        },
      });
      return { duplicate: false };
    });
  }
  /** Internal operator diagnostics; never a public address/suppression lookup API. */
  inspectProviderMessage(providerMessageId: string) {
    return this.transaction(async (tx) => {
      const record = await tx.emailProviderMessage.findUnique({
        where: {
          region_providerMessageId: {
            region: this.config.region,
            providerMessageId,
          },
        },
        include: { outbound: true },
      });
      if (!record) return null;
      const suppressed = await tx.emailSuppression.count({
        where: { recipientHash: { in: record.outbound.recipientHashes } },
      });
      return {
        feedbackStatus: record.outbound.feedbackStatus,
        suppressedRecipients: suppressed,
      };
    });
  }
}
