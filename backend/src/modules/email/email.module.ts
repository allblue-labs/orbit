import { Module } from '@nestjs/common';
import {
  EMAIL_CONFIGURATION,
  SES_EMAIL_CLIENT,
  emailConfiguration,
  createSesEmailClient,
  type EmailConfiguration,
} from './email.config';
import { EmailService } from './email.service';
import { EmailTransportRepository } from './email-transport.repository';
import {
  SES_FEEDBACK_CONFIGURATION,
  SES_SNS_CLIENT,
  createSesSnsClient,
  sesFeedbackConfiguration,
} from './ses-feedback.config';
import { SesFeedbackController } from './ses-feedback.controller';
import { SesFeedbackService } from './ses-feedback.service';
import { SnsMessageVerifier } from './sns-message.verifier';
import { SnsCertificateFetcher } from './sns-certificate.fetcher';

@Module({
  controllers: [SesFeedbackController],
  providers: [
    {
      provide: SES_FEEDBACK_CONFIGURATION,
      useFactory: () => sesFeedbackConfiguration(),
    },
    { provide: SES_SNS_CLIENT, useFactory: () => createSesSnsClient() },
    EmailTransportRepository,
    SesFeedbackService,
    SnsMessageVerifier,
    SnsCertificateFetcher,
    { provide: EMAIL_CONFIGURATION, useFactory: () => emailConfiguration() },
    {
      provide: SES_EMAIL_CLIENT,
      inject: [EMAIL_CONFIGURATION],
      useFactory: (config: EmailConfiguration) => createSesEmailClient(config),
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
