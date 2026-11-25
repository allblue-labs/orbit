import { SESv2Client } from '@aws-sdk/client-sesv2';
import { isEmail } from 'class-validator';
import type { EmailCategory } from './email.types';
export type EmailProvider = 'ses' | 'noop';
export interface EmailConfiguration {
  provider: EmailProvider;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  from?: string;
  configurationSet?: string;
  routes?: Record<EmailCategory, { from?: string; replyTo?: string }>;
  supportInbox?: string;
}

/** Only environment variables are consulted; AWS profiles/metadata are never used. */
export function emailConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): EmailConfiguration {
  const address = (key: string, fallback?: string) => {
    const value = env[key]?.trim().toLowerCase() || fallback;
    if (value && (!isEmail(value) || /[\r\n]/.test(value)))
      throw new Error(`${key} must contain one valid email address`);
    return value;
  };
  const from = address('AWS_SES_FROM_EMAIL');
  const replyTo = address('AWS_SES_SUPPORT_REPLY_TO_EMAIL');
  return {
    // Tests never contact AWS; all other environments use SES exclusively.
    provider: env.NODE_ENV === 'test' ? 'noop' : 'ses',
    region: env.AWS_REGION?.trim(),
    accessKeyId: env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY?.trim(),
    sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined,
    from,
    routes: {
      TRANSACTIONAL: {
        from: address('AWS_SES_FROM_TRANSACTIONAL_EMAIL', from),
      },
      INFORMATIONAL: {
        from: address('AWS_SES_FROM_INFORMATIONAL_EMAIL', from),
        replyTo,
      },
      SUPPORT: { from: address('AWS_SES_FROM_SUPPORT_EMAIL', from), replyTo },
    },
    supportInbox: address('ORBIT_SUPPORT_TO_EMAIL', 'contato@allblue-labs.com'),
    configurationSet: env.AWS_SES_CONFIGURATION_SET?.trim() || undefined,
  };
}

export function emailRoute(
  config: EmailConfiguration,
  category: EmailCategory = 'TRANSACTIONAL',
) {
  if (!['TRANSACTIONAL', 'INFORMATIONAL', 'SUPPORT'].includes(category))
    throw new Error('EMAIL_CATEGORY_INVALID');
  return config.routes?.[category] ?? { from: config.from };
}

export const EMAIL_CONFIGURATION = Symbol('EMAIL_CONFIGURATION');
export const SES_EMAIL_CLIENT = Symbol('SES_EMAIL_CLIENT');

/** Shared transport options for delivery and the read-only preflight. */
export function createSesEmailClient(
  config: EmailConfiguration,
): SESv2Client | null {
  if (
    config.provider !== 'ses' ||
    !config.region ||
    !config.accessKeyId ||
    !config.secretAccessKey ||
    !config.from
  )
    return null;
  return new SESv2Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
    },
    maxAttempts: 1,
    retryMode: 'standard',
    requestHandler: {
      connectionTimeout: 2_000,
      requestTimeout: 5_000,
      throwOnRequestTimeout: true,
    },
  });
}
