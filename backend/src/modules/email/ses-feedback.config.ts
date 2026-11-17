import { SNSClient } from '@aws-sdk/client-sns';
import { emailConfiguration } from './email.config';

export interface SesFeedbackConfiguration {
  enabled: boolean;
  region: string;
  accountId: string;
  topicArn: string;
  identityArn: string;
  from: string;
  hashKey: string;
  senderIdentities?: Readonly<Record<string, string>>;
}
export const SES_FEEDBACK_CONFIGURATION = Symbol('SES_FEEDBACK_CONFIGURATION');
export const SES_SNS_CLIENT = Symbol('SES_SNS_CLIENT');

export function emailSuppressionHashKey(raw: string | undefined): Buffer {
  const value = raw?.trim() ?? '';
  const bytes = Buffer.from(value, 'base64');
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value) || bytes.length !== 32)
    throw new Error(
      'EMAIL_SUPPRESSION_HASH_KEY must be a base64-encoded 32-byte key',
    );
  return bytes;
}

/** Explicit deployment trust. No account, topic, endpoint or credentials from a request. */
export function sesFeedbackConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): SesFeedbackConfiguration {
  const flag = env.AWS_SES_FEEDBACK_ENABLED?.trim() || 'false';
  if (!['true', 'false'].includes(flag))
    throw new Error('AWS_SES_FEEDBACK_ENABLED must be true or false');
  const config = {
    enabled: flag === 'true',
    region: env.AWS_REGION?.trim() ?? '',
    accountId: env.AWS_SES_FEEDBACK_ACCOUNT_ID?.trim() ?? '',
    topicArn: env.AWS_SES_FEEDBACK_TOPIC_ARN?.trim() ?? '',
    identityArn: env.AWS_SES_FEEDBACK_IDENTITY_ARN?.trim() ?? '',
    from: env.AWS_SES_FROM_EMAIL?.trim().toLowerCase() ?? '',
    hashKey: env.EMAIL_SUPPRESSION_HASH_KEY?.trim() ?? '',
  };
  if (config.enabled || env.NODE_ENV === 'production')
    emailSuppressionHashKey(config.hashKey);
  if (!config.enabled) return config;
  if (
    !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(config.region) ||
    !/^\d{12}$/.test(config.accountId)
  )
    throw new Error('SES feedback requires a valid AWS region and account');
  const prefix = `arn:aws:sns:${config.region}:${config.accountId}:`;
  if (
    !config.topicArn.startsWith(prefix) ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(config.topicArn.slice(prefix.length))
  )
    throw new Error(
      'SES feedback topic must match the configured account and region',
    );
  const identityPrefix = `arn:aws:ses:${config.region}:${config.accountId}:identity/`;
  const identity = config.identityArn.slice(identityPrefix.length);
  const domain = config.from.slice(config.from.lastIndexOf('@') + 1);
  if (
    !config.from.includes('@') ||
    !config.identityArn.startsWith(identityPrefix) ||
    ![config.from, domain].includes(identity)
  )
    throw new Error(
      'SES feedback identity must match the configured sender, region and account',
    );
  const email = emailConfiguration(env);
  let mapped: unknown = {};
  try {
    mapped = JSON.parse(env.AWS_SES_FEEDBACK_SENDER_IDENTITIES?.trim() || '{}');
  } catch {
    throw new Error('AWS_SES_FEEDBACK_SENDER_IDENTITIES must be a JSON object');
  }
  if (!mapped || typeof mapped !== 'object' || Array.isArray(mapped))
    throw new Error('AWS_SES_FEEDBACK_SENDER_IDENTITIES must be a JSON object');
  const identities: Record<string, string> = {
    [config.from]: config.identityArn,
  };
  const senders = new Set([
    config.from,
    ...Object.values(email.routes ?? {})
      .map((route) => route.from)
      .filter((v): v is string => !!v),
  ]);
  for (const [sender, arn] of Object.entries(mapped)) {
    const domain = sender.slice(sender.lastIndexOf('@') + 1);
    if (
      !senders.has(sender) ||
      typeof arn !== 'string' ||
      !arn.startsWith(identityPrefix) ||
      ![sender, domain].includes(arn.slice(identityPrefix.length))
    )
      throw new Error(
        'SES sender identity must match an explicit configured address, account and region',
      );
    if (sender === config.from && arn !== config.identityArn)
      throw new Error(
        'SES default identity conflicts with sender identity map',
      );
    identities[sender] = arn;
  }
  for (const sender of senders)
    if (!identities[sender])
      throw new Error(
        'Resolve each category sender in AWS_SES_FEEDBACK_SENDER_IDENTITIES before enabling feedback',
      );
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(env.AWS_SES_CONFIGURATION_SET?.trim() ?? '')
  )
    throw new Error(
      'AWS_SES_CONFIGURATION_SET is required for SES feedback correlation',
    );
  return { ...config, senderIdentities: identities };
}

export function createSesSnsClient(
  env: NodeJS.ProcessEnv = process.env,
): SNSClient | null {
  const feedback = sesFeedbackConfiguration(env);
  const email = emailConfiguration(env);
  if (!feedback.enabled || !email.accessKeyId || !email.secretAccessKey)
    return null;
  return new SNSClient({
    region: feedback.region,
    credentials: {
      accessKeyId: email.accessKeyId,
      secretAccessKey: email.secretAccessKey,
      sessionToken: email.sessionToken,
    },
    maxAttempts: 2,
    requestHandler: {
      connectionTimeout: 2_000,
      requestTimeout: 5_000,
      throwOnRequestTimeout: true,
    },
  });
}
