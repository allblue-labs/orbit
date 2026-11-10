export type EmailProvider = 'ses' | 'noop';
export interface EmailConfiguration {
  provider: EmailProvider;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  from?: string;
}

/** Only environment variables are consulted; AWS profiles/metadata are never used. */
export function emailConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): EmailConfiguration {
  return {
    // Tests never contact AWS; all other environments use SES exclusively.
    provider: env.NODE_ENV === 'test' ? 'noop' : 'ses',
    region: env.AWS_REGION?.trim(),
    accessKeyId: env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY?.trim(),
    sessionToken: env.AWS_SESSION_TOKEN?.trim() || undefined,
    from: env.AWS_SES_FROM_EMAIL?.trim(),
  };
}

export const EMAIL_CONFIGURATION = Symbol('EMAIL_CONFIGURATION');
export const SES_EMAIL_CLIENT = Symbol('SES_EMAIL_CLIENT');
