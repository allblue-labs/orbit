import { emailConfiguration, emailRoute } from './email.config';
import { sesFeedbackConfiguration } from './ses-feedback.config';
import { parseSesFeedback } from './ses-feedback.parser';
import { transactionalEmail } from './transactional-templates';

const env = {
  NODE_ENV: 'test',
  AWS_SES_FROM_EMAIL: 'contato@example.test',
  AWS_REGION: 'us-east-2',
  AWS_SES_FROM_TRANSACTIONAL_EMAIL: 'no-reply@example.test',
  AWS_SES_FROM_INFORMATIONAL_EMAIL: 'avisos-orbit@example.test',
  AWS_SES_FROM_SUPPORT_EMAIL: 'suporte-orbit@example.test',
  AWS_SES_SUPPORT_REPLY_TO_EMAIL: 'contato@example.test',
};
const prefix = 'arn:aws:ses:us-east-2:123456789012:identity/';
const identities = Object.fromEntries(
  ['no-reply', 'avisos-orbit', 'suporte-orbit'].map((name) => [
    `${name}@example.test`,
    prefix + 'example.test',
  ]),
);
const feedbackEnv = {
  ...env,
  AWS_SES_FEEDBACK_ENABLED: 'true',
  AWS_SES_FEEDBACK_ACCOUNT_ID: '123456789012',
  AWS_SES_FEEDBACK_TOPIC_ARN: 'arn:aws:sns:us-east-2:123456789012:orbit',
  AWS_SES_FEEDBACK_IDENTITY_ARN: prefix + 'contato@example.test',
  EMAIL_SUPPRESSION_HASH_KEY: Buffer.alloc(32, 12).toString('base64'),
  AWS_SES_CONFIGURATION_SET: 'orbit',
  AWS_SES_FEEDBACK_SENDER_IDENTITIES: JSON.stringify(identities),
};
describe('email categories and exact feedback provenance', () => {
  it('separates senders and replies without accepting arbitrary From addresses', () => {
    const config = emailConfiguration(env);
    expect(emailRoute(config, 'TRANSACTIONAL')).toEqual({
      from: 'no-reply@example.test',
    });
    expect(emailRoute(config, 'INFORMATIONAL')).toEqual({
      from: 'avisos-orbit@example.test',
      replyTo: 'contato@example.test',
    });
    expect(emailRoute(config, 'SUPPORT')).toEqual({
      from: 'suporte-orbit@example.test',
      replyTo: 'contato@example.test',
    });
    expect(() => emailRoute(config, 'arbitrary' as never)).toThrow(
      'EMAIL_CATEGORY_INVALID',
    );
    expect(() =>
      emailConfiguration({
        ...env,
        AWS_SES_FROM_SUPPORT_EMAIL:
          'a@example.test\r\nBcc: stolen@example.test',
      }),
    ).toThrow();
  });
  it('preserves the existing verified sender when category envs are absent', () => {
    const config = emailConfiguration({
      NODE_ENV: 'test',
      AWS_SES_FROM_EMAIL: 'verified@example.test',
    });
    for (const category of [
      'TRANSACTIONAL',
      'INFORMATIONAL',
      'SUPPORT',
    ] as const)
      expect(emailRoute(config, category).from).toBe('verified@example.test');
  });
  it.each([
    'WELCOME',
    'EMAIL_VERIFICATION',
    'PASSWORD_RESET',
    'PASSWORD_CHANGED',
  ] as const)('%s uses the account/security sender', (template) => {
    expect(
      transactionalEmail(template, { link: 'https://orbit.example.test/login' })
        .category,
    ).toBe('TRANSACTIONAL');
  });
  it.each(['PLAN_EXPIRED', 'PLAN_LIMIT_REACHED'] as const)(
    '%s uses the information sender',
    (template) => {
      expect(
        transactionalEmail(template, {
          link: 'https://orbit.example.test/login',
        }).category,
      ).toBe('INFORMATIONAL');
    },
  );
  it('accepts feedback for each exact sender/identity pair and preserves the old sender', () => {
    const config = sesFeedbackConfiguration(feedbackEnv);
    for (const [source, sourceArn] of Object.entries({
      ...identities,
      'contato@example.test': prefix + 'contato@example.test',
    })) {
      const event = {
        eventType: 'Delivery',
        mail: {
          sendingAccountId: '123456789012',
          source,
          sourceArn,
          messageId: 'synthetic-message-id',
          destination: ['owner@example.test'],
          timestamp: new Date().toISOString(),
        },
        delivery: {
          timestamp: new Date().toISOString(),
          recipients: ['owner@example.test'],
        },
      };
      expect(parseSesFeedback(JSON.stringify(event), config).kind).toBe(
        'DELIVERY',
      );
      expect(() =>
        parseSesFeedback(
          JSON.stringify({
            ...event,
            mail: { ...event.mail, source: 'unlisted@example.test' },
          }),
          config,
        ),
      ).toThrow();
      expect(() =>
        parseSesFeedback(
          JSON.stringify({
            ...event,
            mail: { ...event.mail, sourceArn: prefix + 'attacker.test' },
          }),
          config,
        ),
      ).toThrow();
    }
  });
  it('fails closed on an unmapped category and refuses wildcard or cross-account mappings', () => {
    expect(() =>
      sesFeedbackConfiguration({
        ...feedbackEnv,
        AWS_SES_FEEDBACK_SENDER_IDENTITIES: '',
      }),
    ).toThrow();
    for (const value of [
      { ...identities, '*@example.test': prefix + 'example.test' },
      {
        ...identities,
        'no-reply@example.test':
          'arn:aws:ses:us-east-2:999999999999:identity/example.test',
      },
      [],
    ])
      expect(() =>
        sesFeedbackConfiguration({
          ...feedbackEnv,
          AWS_SES_FEEDBACK_SENDER_IDENTITIES: JSON.stringify(value),
        }),
      ).toThrow();
  });
});
