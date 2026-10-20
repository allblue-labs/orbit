import { InfrastructureException } from './exceptions';

const PLACEHOLDER = /change[-_]?me|placeholder|example|dummy|test[-_]?only/i;

/**
 * Fail-closed checks for values whose absence would otherwise surface only
 * after the first customer action. Values are never included in errors.
 */
export function validateReleaseEnvironment(
  environment: NodeJS.ProcessEnv,
): void {
  if (environment.NODE_ENV !== 'production') return;

  const secret = (key: string, minimum: number): string => {
    const value = environment[key]?.trim() ?? '';
    if (value.length < minimum || PLACEHOLDER.test(value)) {
      throw new InfrastructureException(
        `${key} must be configured with a non-placeholder value of at least ${minimum} characters`,
      );
    }
    return value;
  };

  secret('JWT_ACCESS_SECRET', 32);
  secret('TRIAL_FINGERPRINT_SECRET', 32);

  for (const key of ['SMTP_HOST', 'EMAIL_FROM', 'IDENTITY_PUBLIC_WEB_URL']) {
    if (!(environment[key]?.trim() ?? '')) {
      throw new InfrastructureException(`${key} must be configured`);
    }
  }
  const smtpPort = Number(environment.SMTP_PORT ?? 587);
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65_535) {
    throw new InfrastructureException('SMTP_PORT must be between 1 and 65535');
  }
  const smtpUser = environment.SMTP_USER?.trim() ?? '';
  const smtpPassword = environment.SMTP_PASSWORD?.trim() ?? '';
  if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
    throw new InfrastructureException(
      'SMTP_USER and SMTP_PASSWORD must be configured together',
    );
  }

  const encryption = Buffer.from(secret('ENCRYPTION_KEY', 32), 'base64');
  if (encryption.length !== 32) {
    throw new InfrastructureException(
      'ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  }

  const origins = (environment.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.includes('*')) {
    throw new InfrastructureException(
      'FRONTEND_ORIGIN must contain at least one explicit production origin',
    );
  }
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new InfrastructureException(
        'FRONTEND_ORIGIN contains an invalid absolute origin',
      );
    }
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.origin !== origin || (url.protocol !== 'https:' && !local)) {
      throw new InfrastructureException(
        'FRONTEND_ORIGIN must use origin-only HTTPS URLs outside localhost',
      );
    }
  }

  let identityUrl: URL;
  try {
    identityUrl = new URL(environment.IDENTITY_PUBLIC_WEB_URL!);
  } catch {
    throw new InfrastructureException(
      'IDENTITY_PUBLIC_WEB_URL must be a valid absolute URL',
    );
  }
  const localIdentityUrl = ['localhost', '127.0.0.1', '::1'].includes(
    identityUrl.hostname,
  );
  if (
    identityUrl.origin !== environment.IDENTITY_PUBLIC_WEB_URL ||
    (identityUrl.protocol !== 'https:' && !localIdentityUrl)
  ) {
    throw new InfrastructureException(
      'IDENTITY_PUBLIC_WEB_URL must be an origin-only HTTPS URL outside localhost',
    );
  }
}
