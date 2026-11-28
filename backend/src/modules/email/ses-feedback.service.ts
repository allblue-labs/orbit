import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfirmSubscriptionCommand, SNSClient } from '@aws-sdk/client-sns';
import {
  SES_FEEDBACK_CONFIGURATION,
  SES_SNS_CLIENT,
  type SesFeedbackConfiguration,
} from './ses-feedback.config';
import { SnsMessageVerifier } from './sns-message.verifier';
import { EmailTransportRepository } from './email-transport.repository';
import { parseSesFeedback } from './ses-feedback.parser';
import { SesFeedbackError } from './ses-feedback.types';

@Injectable()
export class SesFeedbackService implements OnModuleDestroy {
  private readonly logger = new Logger(SesFeedbackService.name);
  constructor(
    private readonly verifier: SnsMessageVerifier,
    private readonly repository: EmailTransportRepository,
    @Inject(SES_FEEDBACK_CONFIGURATION)
    private readonly config: SesFeedbackConfiguration,
    @Inject(SES_SNS_CLIENT) private readonly sns: SNSClient | null,
  ) {}
  async receive(body: unknown): Promise<void> {
    const { envelope, payloadHash } = await this.verifier.authenticate(body);
    const identity = {
      topicArn: envelope.TopicArn,
      messageId: envelope.MessageId,
      payloadHash,
    };
    if (envelope.Type === 'Notification') {
      const feedback = parseSesFeedback(envelope.Message, this.config);
      this.logger.log(
        JSON.stringify({
          event: 'ses_feedback',
          stage: 'AUTHENTICATED',
          snsMessageId: envelope.MessageId,
          kind: feedback.kind,
        }),
      );
      const result = await this.repository.apply(identity, feedback);
      this.logger.log(
        JSON.stringify({
          event: 'ses_feedback',
          snsMessageId: envelope.MessageId,
          kind: feedback.kind,
          result: result.duplicate ? 'DUPLICATE' : 'PROCESSED',
        }),
      );
      return;
    }
    if (envelope.Type === 'UnsubscribeConfirmation') {
      await this.repository.recordUnsubscribe(identity);
      this.logger.warn(
        JSON.stringify({
          event: 'ses_feedback',
          code: 'SNS_SUBSCRIPTION_UNSUBSCRIBED',
        }),
      );
      return;
    }
    if (!this.sns)
      throw new SesFeedbackError('SNS_CONFIRMATION_NOT_CONFIGURED', 503);
    const claim = await this.repository.claimConfirmation(identity);
    if (!claim) return;
    try {
      const confirmed = await this.sns.send(
        new ConfirmSubscriptionCommand({
          TopicArn: this.config.topicArn,
          Token: envelope.Token!,
          AuthenticateOnUnsubscribe: 'true',
        }),
      );
      if (!confirmed.SubscriptionArn?.startsWith(this.config.topicArn + ':'))
        throw new SesFeedbackError('SNS_CONFIRMATION_NOT_CONFIRMED', 503);
      await this.repository.finishConfirmation(
        claim,
        confirmed.SubscriptionArn,
      );
      this.logger.log(
        JSON.stringify({
          event: 'ses_feedback',
          code: 'SNS_SUBSCRIPTION_CONFIRMED',
        }),
      );
    } catch {
      await this.repository.releaseConfirmation(claim);
      throw new SesFeedbackError('SNS_CONFIRMATION_RETRY', 503);
    }
  }
  onModuleDestroy() {
    this.sns?.destroy();
  }
}
