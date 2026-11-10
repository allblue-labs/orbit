import { Module } from '@nestjs/common';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import {
  EMAIL_CONFIGURATION,
  SES_EMAIL_CLIENT,
  emailConfiguration,
  type EmailConfiguration,
} from './email.config';
import { EmailService } from './email.service';

@Module({
  providers: [
    { provide: EMAIL_CONFIGURATION, useFactory: () => emailConfiguration() },
    {
      provide: SES_EMAIL_CLIENT,
      inject: [EMAIL_CONFIGURATION],
      useFactory: (config: EmailConfiguration) =>
        config.provider === 'ses' &&
        config.region &&
        config.accessKeyId &&
        config.secretAccessKey &&
        config.from
          ? new SESv2Client({
              region: config.region,
              // Explicit credentials prevent fallback to shared files, profiles or instance metadata.
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
                sessionToken: config.sessionToken,
              },
              maxAttempts: 3,
              retryMode: 'standard',
              requestHandler: {
                connectionTimeout: 2_000,
                requestTimeout: 5_000,
                throwOnRequestTimeout: true,
              },
            })
          : null,
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
