import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  SendEmailCommand,
  SESv2Client,
  SESv2ServiceException,
} from '@aws-sdk/client-sesv2';
import { isEmail } from 'class-validator';
import {
  EMAIL_CONFIGURATION,
  SES_EMAIL_CLIENT,
  type EmailConfiguration,
} from './email.config';

import type { EmailMessage, EmailSendResult } from './email.types';
import {
  EmailTransportRepository,
  normalizeEmail,
} from './email-transport.repository';
export type { EmailMessage, EmailSendResult } from './email.types';

/** Shared transactional sender. No recipients, bodies, links or credentials enter logs. */
@Injectable()
export class EmailService implements OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(EMAIL_CONFIGURATION) private readonly config: EmailConfiguration,
    @Inject(SES_EMAIL_CLIENT) private readonly ses: SESv2Client | null,
    private readonly repository: EmailTransportRepository,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const provider = this.config.provider;
    if (provider === 'noop') return { status: 'SKIPPED', provider };
    let outboundId: string | undefined;
    let accepted = false;
    try {
      if (!isEmail(message.to) || /[\r\n]/.test(message.subject))
        return this.failed('INVALID_MESSAGE', false);
      if (!this.config.from || !this.config.region || !this.ses)
        return this.failed('EMAIL_NOT_CONFIGURED', false);
      try {
        if (message.identityDeliveryId) {
          const previous = await this.repository.acceptedDelivery(
            message.identityDeliveryId,
            message.to,
            this.config.from,
            this.config.region,
          );
          if (previous)
            return {
              status: 'SENT',
              provider: 'ses',
              providerMessageId: previous,
            };
        }
        const prepared = await this.repository.prepare(
          message.to,
          this.config.from,
          this.config.region,
          message.identityDeliveryId,
        );
        if (!prepared) return this.failed('EMAIL_SUPPRESSED', false);
        outboundId = prepared;
      } catch {
        return this.failed('EMAIL_STATE_UNAVAILABLE', true);
      }
      const result = await this.ses.send(
        new SendEmailCommand({
          FromEmailAddress: this.config.from,
          Destination: { ToAddresses: [normalizeEmail(message.to)] },
          EmailTags: [{ Name: 'orbit_delivery_id', Value: outboundId }],
          ...(this.config.configurationSet
            ? { ConfigurationSetName: this.config.configurationSet }
            : {}),
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: 'UTF-8' },
              Body: {
                Text: { Data: message.text, Charset: 'UTF-8' },
                ...(message.html
                  ? { Html: { Data: message.html, Charset: 'UTF-8' } }
                  : {}),
              },
              ...(message.html && message.inlineImages?.length
                ? {
                    Attachments: message.inlineImages.map((image) => ({
                      RawContent: image.content,
                      FileName: image.fileName,
                      ContentId: image.contentId,
                      ContentType: image.contentType,
                      ContentDisposition: 'INLINE' as const,
                      ContentTransferEncoding: 'BASE64' as const,
                    })),
                  }
                : {}),
            },
          },
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
      accepted = true;
      if (!result.MessageId) return this.failed('SES_MESSAGE_ID_MISSING', true);
      try {
        await this.repository.accepted(outboundId, result.MessageId);
      } catch {
        return this.failed('EMAIL_STATE_UNAVAILABLE', true);
      }
      return {
        status: 'SENT',
        provider,
        providerMessageId: result.MessageId,
      };
    } catch (error) {
      if (error instanceof SESv2ServiceException) {
        const codes: Record<string, string> = {
          MessageRejected: 'SES_MESSAGE_REJECTED',
          MailFromDomainNotVerifiedException: 'SES_IDENTITY_NOT_VERIFIED',
          AccountSuspendedException: 'SES_ACCOUNT_SUSPENDED',
          SendingPausedException: 'SES_SENDING_PAUSED',
          TooManyRequestsException: 'SES_THROTTLED',
          LimitExceededException: 'SES_LIMIT_EXCEEDED',
          BadRequestException: 'SES_INVALID_REQUEST',
          NotFoundException: 'SES_RESOURCE_NOT_FOUND',
          AccessDeniedException: 'SES_ACCESS_DENIED',
          UnrecognizedClientException: 'AWS_CREDENTIALS_REJECTED',
          InvalidClientTokenId: 'AWS_CREDENTIALS_REJECTED',
          SignatureDoesNotMatch: 'AWS_CREDENTIALS_REJECTED',
          InvalidSignatureException: 'AWS_CREDENTIALS_REJECTED',
          ExpiredTokenException: 'AWS_CREDENTIALS_EXPIRED',
        };
        const retryable =
          error.$metadata.httpStatusCode === 429 ||
          (error.$metadata.httpStatusCode ?? 0) >= 500 ||
          Boolean(error.$retryable);
        if (outboundId && !accepted)
          await this.repository
            .failed(outboundId, retryable)
            .catch(() => undefined);
        return this.failed(codes[error.name] ?? 'SES_SERVICE_ERROR', retryable);
      }
      if (outboundId && !accepted)
        await this.repository.failed(outboundId, true).catch(() => undefined);
      // Never log SDK error messages: they may contain recipients or signed links.
      return this.failed('EMAIL_TRANSPORT_ERROR', true);
    }
  }

  private failed(code: string, retryable: boolean): EmailSendResult {
    this.logger.error(
      JSON.stringify({
        event: 'email_send_failed',
        provider: this.config.provider,
        code,
        retryable,
      }),
    );
    return {
      status: 'FAILED',
      provider: 'ses',
      code,
      retryable,
    };
  }

  onModuleDestroy(): void {
    this.ses?.destroy();
  }
}
