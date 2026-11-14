import { Module } from '@nestjs/common';
import {
  EMAIL_CONFIGURATION,
  SES_EMAIL_CLIENT,
  emailConfiguration,
  createSesEmailClient,
  type EmailConfiguration,
} from './email.config';
import { EmailService } from './email.service';

@Module({
  providers: [
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
