import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, sign } from 'node:crypto';
import type { SesFeedbackConfiguration } from '../../src/modules/email/ses-feedback.config';
import type { SnsEnvelope } from '../../src/modules/email/sns-message.verifier';

/** Ephemeral test CA/key, never an AWS key and never written in the repository.
 * Only the HTTPS certificate distribution boundary is mocked; RSA verification is real.
 */
export function snsFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-sns-test-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-subj',
        '/CN=sns.us-east-2.amazonaws.com',
        '-days',
        '10',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    const key = readFileSync(join(dir, 'key.pem'), 'utf8');
    const certificate = readFileSync(join(dir, 'cert.pem'), 'utf8');
    const config: SesFeedbackConfiguration = {
      enabled: true,
      region: 'us-east-2',
      accountId: '123456789012',
      topicArn: 'arn:aws:sns:us-east-2:123456789012:orbit-test-feedback',
      identityArn: 'arn:aws:ses:us-east-2:123456789012:identity/example.test',
      from: 'no-reply@example.test',
      hashKey: Buffer.alloc(32, 19).toString('base64'),
    };
    const resign = (input: SnsEnvelope): SnsEnvelope => {
      // Independent AWS HTTP canonical fixture, not the verifier's implementation.
      const parts = ['Message', input.Message, 'MessageId', input.MessageId];
      if (input.Type === 'Notification' && input.Subject !== undefined)
        parts.push('Subject', input.Subject);
      if (input.Type !== 'Notification')
        parts.push('SubscribeURL', input.SubscribeURL!);
      parts.push('Timestamp', input.Timestamp);
      if (input.Type !== 'Notification') parts.push('Token', input.Token!);
      parts.push('TopicArn', input.TopicArn, 'Type', input.Type);
      return {
        ...input,
        Signature: sign(
          'RSA-SHA256',
          Buffer.from(parts.join('\n') + '\n', 'utf8'),
          key,
        ).toString('base64'),
      };
    };
    const envelope = (
      message: unknown,
      override: Partial<SnsEnvelope> = {},
    ): SnsEnvelope =>
      resign({
        Type: 'Notification',
        MessageId: randomUUID(),
        TopicArn: config.topicArn,
        Message: JSON.stringify(message),
        Timestamp: new Date().toISOString(),
        SignatureVersion: '2',
        Signature: '',
        SigningCertURL: `https://sns.${config.region}.amazonaws.com/SimpleNotificationService-${'a'.repeat(32)}.pem`,
        ...override,
      });
    return { config, certificate, envelope, resign };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
