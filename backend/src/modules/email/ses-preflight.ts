import {
  GetAccountCommand,
  GetEmailIdentityCommand,
  SESv2Client,
  type GetEmailIdentityCommandOutput,
} from '@aws-sdk/client-sesv2';
import { isEmail } from 'class-validator';
import type { EmailConfiguration } from './email.config';

export function validateSesConfiguration(config: EmailConfiguration) {
  if (!config.accessKeyId || !config.secretAccessKey)
    throw new Error(
      'AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY devem ser configuradas.',
    );
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(config.region ?? ''))
    throw new Error('AWS_REGION deve conter o código da região do SES.');
  if (!isEmail(config.from ?? ''))
    throw new Error(
      'AWS_SES_FROM_EMAIL deve ser um endereço de e-mail válido.',
    );
}

export interface SesPreflightReport {
  region: string;
  status: 'READY' | 'SANDBOX' | 'BLOCKED';
  productionAccess: boolean;
  sendingEnabled: boolean;
  identityVerified: boolean;
  quotaAvailable: boolean;
  quota: {
    max24HourSend: number;
    maxSendRate: number;
    sentLast24Hours: number;
  };
}

/** Read-only regional AWS state. No SendEmail, account changes or local approval flags. */
export async function sesPreflight(
  client: Pick<SESv2Client, 'send'>,
  config: EmailConfiguration,
): Promise<SesPreflightReport> {
  validateSesConfiguration(config);
  const account = await client.send(new GetAccountCommand({}));
  const address = config.from!;
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  const labels = domain.split('.');
  const identities = [
    address,
    ...labels.slice(0, -1).map((_, i) => labels.slice(i).join('.')),
  ];
  let identity: GetEmailIdentityCommandOutput | undefined;
  for (const name of identities) {
    try {
      const candidate = await client.send(
        new GetEmailIdentityCommand({ EmailIdentity: name }),
      );
      identity = candidate;
      if (candidate.VerifiedForSendingStatus === true) break;
    } catch (error) {
      if (!(error instanceof Error && error.name === 'NotFoundException'))
        throw error;
    }
  }
  const quota = {
    max24HourSend: account.SendQuota?.Max24HourSend ?? 0,
    maxSendRate: account.SendQuota?.MaxSendRate ?? 0,
    sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
  };
  const productionAccess = account.ProductionAccessEnabled === true;
  const sendingEnabled = account.SendingEnabled === true;
  const identityVerified = identity?.VerifiedForSendingStatus === true;
  // SES uses -1 for an unlimited 24-hour quota; missing data never means ready.
  const quotaKnown = [
    account.SendQuota?.Max24HourSend,
    account.SendQuota?.MaxSendRate,
    account.SendQuota?.SentLast24Hours,
  ].every((value) => typeof value === 'number' && Number.isFinite(value));
  const quotaAvailable =
    quotaKnown &&
    quota.sentLast24Hours >= 0 &&
    (quota.max24HourSend === -1 ||
      quota.max24HourSend > quota.sentLast24Hours) &&
    quota.maxSendRate > 0;
  return {
    region: config.region!,
    productionAccess,
    sendingEnabled,
    identityVerified,
    quotaAvailable,
    quota,
    status:
      !sendingEnabled || !identityVerified || !quotaAvailable
        ? 'BLOCKED'
        : productionAccess
          ? 'READY'
          : 'SANDBOX',
  };
}

export function sesPreflightFailureCode(error: unknown): string {
  const known = [
    'AccessDeniedException',
    'UnrecognizedClientException',
    'InvalidClientTokenId',
    'SignatureDoesNotMatch',
    'ExpiredTokenException',
    'TooManyRequestsException',
    'NotFoundException',
  ];
  return error instanceof Error && known.includes(error.name)
    ? error.name
    : 'SES_PREFLIGHT_FAILED';
}
