import { isEmail, isUUID } from 'class-validator';
import type { SesFeedbackConfiguration } from './ses-feedback.config';
import {
  SesFeedbackError,
  type SesFeedback,
  type FeedbackKind,
} from './ses-feedback.types';
import { normalizeEmail } from './email-transport.repository';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SesFeedbackError('SES_FEEDBACK_INVALID', 400);
  return value as Record<string, unknown>;
}
function addresses(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new SesFeedbackError('SES_RECIPIENTS_INVALID', 400);
  return [
    ...new Set(
      value.map((v: unknown) => {
        if (typeof v !== 'string' || !isEmail(v.trim()))
          throw new SesFeedbackError('SES_RECIPIENTS_INVALID', 400);
        return normalizeEmail(v);
      }),
    ),
  ];
}
export function parseSesFeedback(
  message: string,
  config: SesFeedbackConfiguration,
): SesFeedback {
  let decoded: unknown;
  try {
    decoded = JSON.parse(message) as unknown;
  } catch {
    throw new SesFeedbackError('SES_FEEDBACK_INVALID', 400);
  }
  const input = record(decoded),
    mail = record(input.mail);
  if (
    mail.sendingAccountId !== config.accountId ||
    mail.sourceArn !== config.identityArn ||
    typeof mail.source !== 'string' ||
    normalizeEmail(mail.source) !== config.from
  )
    throw new SesFeedbackError('SES_IDENTITY_DENIED', 403);
  if (
    typeof mail.messageId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,255}$/.test(mail.messageId)
  )
    throw new SesFeedbackError('SES_MESSAGE_ID_INVALID', 400);
  const destination = addresses(mail.destination);
  const type = input.eventType ?? input.notificationType;
  let kind: FeedbackKind = 'IGNORED',
    recipients: string[] = [],
    stamp = mail.timestamp;
  if (type === 'Bounce' || type === 'Complaint' || type === 'Delivery') {
    const detail = record(
      input[
        type === 'Bounce'
          ? 'bounce'
          : type === 'Complaint'
            ? 'complaint'
            : 'delivery'
      ],
    );
    stamp = detail.timestamp;
    if (type === 'Delivery') {
      kind = 'DELIVERY';
      recipients = addresses(detail.recipients);
    } else {
      const raw =
        detail[
          type === 'Bounce' ? 'bouncedRecipients' : 'complainedRecipients'
        ];
      if (!Array.isArray(raw))
        throw new SesFeedbackError('SES_RECIPIENTS_INVALID', 400);
      recipients = addresses(
        raw.map((recipient: unknown) => record(recipient).emailAddress),
      );
      kind =
        type === 'Bounce'
          ? detail.bounceType === 'Permanent'
            ? 'HARD_BOUNCE'
            : 'SOFT_BOUNCE'
          : detail.complaintFeedbackType === 'not-spam'
            ? 'IGNORED'
            : 'COMPLAINT';
    }
  }
  if (
    typeof stamp !== 'string' ||
    !Number.isFinite(Date.parse(stamp)) ||
    Date.parse(stamp) > Date.now() + 5 * 60_000
  )
    throw new SesFeedbackError('SES_TIMESTAMP_INVALID', 400);
  let outboundId: string | undefined;
  if (mail.tags !== undefined) {
    const tag = record(mail.tags).orbit_delivery_id;
    if (tag !== undefined) {
      if (
        !Array.isArray(tag) ||
        tag.length !== 1 ||
        typeof tag[0] !== 'string' ||
        !isUUID(tag[0])
      )
        throw new SesFeedbackError('SES_TAG_INVALID', 400);
      outboundId = tag[0];
    }
  }
  return {
    sesMessageId: mail.messageId,
    outboundId,
    source: normalizeEmail(mail.source),
    destination,
    recipients,
    kind,
    occurredAt: new Date(stamp),
  };
}
