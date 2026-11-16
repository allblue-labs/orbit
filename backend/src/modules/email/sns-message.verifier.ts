import { Inject, Injectable } from '@nestjs/common';
import { createHash, verify, X509Certificate } from 'node:crypto';
import { isUUID } from 'class-validator';
import {
  SES_FEEDBACK_CONFIGURATION,
  type SesFeedbackConfiguration,
} from './ses-feedback.config';
import { SesFeedbackError } from './ses-feedback.types';
import { SnsCertificateFetcher } from './sns-certificate.fetcher';

export interface SnsEnvelope {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: '2';
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}
const fields = (type: SnsEnvelope['Type']) =>
  type === 'Notification'
    ? ([
        'Message',
        'MessageId',
        'Subject',
        'Timestamp',
        'TopicArn',
        'Type',
      ] as const)
    : ([
        'Message',
        'MessageId',
        'SubscribeURL',
        'Timestamp',
        'Token',
        'TopicArn',
        'Type',
      ] as const);
/** SNS fixed ordering, UTF-8 values and final newline; no JSON reserialization. */
export function snsStringToSign(input: SnsEnvelope): string {
  return fields(input.Type)
    .filter((name) => input[name] !== undefined)
    .map((name) => `${name}\n${input[name]}\n`)
    .join('');
}
@Injectable()
export class SnsMessageVerifier {
  private readonly cache = new Map<
    string,
    { certificate: X509Certificate; until: number }
  >();
  private readonly pending = new Map<string, Promise<X509Certificate>>();
  constructor(
    @Inject(SES_FEEDBACK_CONFIGURATION)
    private readonly config: SesFeedbackConfiguration,
    private readonly fetcher: SnsCertificateFetcher,
  ) {}

  private url(raw: string, kind: 'certificate' | 'confirmation'): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new SesFeedbackError('SNS_URL_DENIED', 403);
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== `sns.${this.config.region}.amazonaws.com` ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new SesFeedbackError('SNS_URL_DENIED', 403);
    if (
      kind === 'certificate' &&
      (url.search ||
        !/^\/SimpleNotificationService-[a-fA-F0-9]{32,64}\.pem$/.test(
          url.pathname,
        ))
    )
      throw new SesFeedbackError('SNS_URL_DENIED', 403);
    if (
      kind === 'confirmation' &&
      (url.pathname !== '/' ||
        url.searchParams.get('Action') !== 'ConfirmSubscription' ||
        url.searchParams.getAll('Action').length !== 1 ||
        url.searchParams.getAll('TopicArn').length !== 1 ||
        url.searchParams.getAll('Token').length !== 1)
    )
      throw new SesFeedbackError('SNS_URL_DENIED', 403);
    return url;
  }
  private certificate(url: URL): Promise<X509Certificate> {
    const cached = this.cache.get(url.href);
    if (cached && cached.until > Date.now())
      return Promise.resolve(cached.certificate);
    this.cache.delete(url.href);
    const existing = this.pending.get(url.href);
    if (existing) return existing;
    if (this.pending.size >= 4)
      throw new SesFeedbackError('SNS_CERTIFICATE_BUSY', 503);
    const work = this.fetcher
      .fetch(url)
      .then((pem) => {
        let certificate: X509Certificate;
        try {
          certificate = new X509Certificate(pem);
        } catch {
          throw new SesFeedbackError('SNS_CERTIFICATE_INVALID', 403);
        }
        const start = Date.parse(certificate.validFrom),
          end = Date.parse(certificate.validTo);
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start > Date.now() ||
          end <= Date.now() ||
          certificate.publicKey.asymmetricKeyType !== 'rsa' ||
          (certificate.publicKey.asymmetricKeyDetails?.modulusLength ?? 0) <
            2048
        )
          throw new SesFeedbackError('SNS_CERTIFICATE_INVALID', 403);
        if (this.cache.size >= 16)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(url.href, {
          certificate,
          until: Math.min(end, Date.now() + 60 * 60_000),
        });
        return certificate;
      })
      .finally(() => this.pending.delete(url.href));
    this.pending.set(url.href, work);
    return work;
  }
  async authenticate(
    body: unknown,
  ): Promise<{ envelope: SnsEnvelope; payloadHash: string }> {
    if (!this.config.enabled)
      throw new SesFeedbackError('SNS_FEEDBACK_DISABLED', 503);
    if (typeof body === 'string') {
      if (Buffer.byteLength(body) > 256 * 1024)
        throw new SesFeedbackError('SNS_BODY_TOO_LARGE', 400);
      try {
        body = JSON.parse(body) as unknown;
      } catch {
        throw new SesFeedbackError('SNS_ENVELOPE_INVALID', 400);
      }
    }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new SesFeedbackError('SNS_ENVELOPE_INVALID', 400);
    const value = body as Record<string, unknown>;
    for (const name of [
      'Type',
      'MessageId',
      'TopicArn',
      'Message',
      'Timestamp',
      'SignatureVersion',
      'Signature',
      'SigningCertURL',
    ])
      if (typeof value[name] !== 'string')
        throw new SesFeedbackError('SNS_ENVELOPE_INVALID', 400);
    if (
      (value.Type !== 'Notification' &&
        value.Type !== 'SubscriptionConfirmation' &&
        value.Type !== 'UnsubscribeConfirmation') ||
      !isUUID(value.MessageId) ||
      value.SignatureVersion !== '2'
    )
      throw new SesFeedbackError('SNS_ENVELOPE_INVALID', 400);
    if (value.TopicArn !== this.config.topicArn)
      throw new SesFeedbackError('SNS_TOPIC_DENIED', 403);
    const envelope = value as unknown as SnsEnvelope;
    if (envelope.Subject !== undefined && typeof envelope.Subject !== 'string')
      throw new SesFeedbackError('SNS_ENVELOPE_INVALID', 400);
    if (
      Buffer.byteLength(JSON.stringify(value)) > 256 * 1024 ||
      envelope.Signature.length > 2048 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.Signature)
    )
      throw new SesFeedbackError('SNS_ENVELOPE_INVALID', 400);
    for (const name of fields(envelope.Type)) {
      if (name !== 'Subject' && typeof envelope[name] !== 'string')
        throw new SesFeedbackError('SNS_ENVELOPE_INVALID', 400);
      if (
        name !== 'Message' &&
        name !== 'Subject' &&
        /[\r\n]/.test(envelope[name] ?? '')
      )
        throw new SesFeedbackError('SNS_ENVELOPE_INVALID', 400);
    }
    const stamp = Date.parse(envelope.Timestamp),
      age = Date.now() - stamp;
    // SNS HTTPS retries can span weeks; dedupe is durable, not a five-minute TTL.
    if (
      !Number.isFinite(stamp) ||
      age < -5 * 60_000 ||
      age > 32 * 24 * 60 * 60_000
    )
      throw new SesFeedbackError('SNS_TIMESTAMP_INVALID', 403);
    const url = this.url(envelope.SigningCertURL, 'certificate');
    if (envelope.Type !== 'Notification') {
      const confirmation = this.url(envelope.SubscribeURL!, 'confirmation');
      if (
        !envelope.Token ||
        envelope.Token.length > 8192 ||
        confirmation.searchParams.get('TopicArn') !== this.config.topicArn ||
        confirmation.searchParams.get('Token') !== envelope.Token
      )
        throw new SesFeedbackError('SNS_CONFIRMATION_INVALID', 403);
    }
    const certificate = await this.certificate(url);
    if (
      stamp < Date.parse(certificate.validFrom) ||
      stamp > Date.parse(certificate.validTo)
    )
      throw new SesFeedbackError('SNS_CERTIFICATE_INVALID', 403);
    const canonical = snsStringToSign(envelope);
    if (
      !verify(
        'RSA-SHA256',
        Buffer.from(canonical, 'utf8'),
        certificate.publicKey,
        Buffer.from(envelope.Signature, 'base64'),
      )
    )
      throw new SesFeedbackError('SNS_SIGNATURE_INVALID', 403);
    return {
      envelope,
      payloadHash: createHash('sha256')
        .update(`SNS2\n${canonical}`)
        .digest('hex'),
    };
  }
}
