import { snsFixture } from '../../../test/helpers/sns-fixture';
import { SnsMessageVerifier } from './sns-message.verifier';
import { isPublicSnsAddress } from './sns-certificate.fetcher';
import { sesFeedbackConfiguration } from './ses-feedback.config';

describe('PR-08 SNS cryptographic trust boundary', () => {
  const fixture = snsFixture();
  function setup() {
    const fetcher = { fetch: jest.fn().mockResolvedValue(fixture.certificate) };
    return {
      fetcher,
      verifier: new SnsMessageVerifier(fixture.config, fetcher),
    };
  }
  it('validates a real RSA SHA-256 signature, UTF-8, Subject and final newline', async () => {
    const { verifier, fetcher } = setup();
    const input = fixture.envelope(
      { message: 'Olá\nnotificação' },
      { Subject: 'Título com ç' },
    );
    await expect(
      verifier.authenticate(JSON.stringify(input)),
    ).resolves.toMatchObject({
      envelope: input,
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown,
    });
    await verifier.authenticate(input);
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed message/subject/signature and does not trust a shape-only object', async () => {
    const { verifier } = setup(),
      input = fixture.envelope(
        { message: 'original' },
        { Subject: 'original' },
      );
    for (const altered of [
      { ...input, Message: 'alterado' },
      { ...input, Subject: 'alterado' },
      { ...input, Signature: Buffer.alloc(256).toString('base64') },
    ])
      await expect(verifier.authenticate(altered)).rejects.toMatchObject({
        code: 'SNS_SIGNATURE_INVALID',
      });
    await expect(
      verifier.authenticate({ TopicArn: fixture.config.topicArn }),
    ).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    'http://sns.us-east-2.amazonaws.com/SimpleNotificationService-' +
      'a'.repeat(32) +
      '.pem',
    'https://sns.us-east-2.amazonaws.com.evil.test/key.pem',
    'https://evil.test@sns.us-east-2.amazonaws.com/SimpleNotificationService-' +
      'a'.repeat(32) +
      '.pem',
    'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-' +
      'a'.repeat(32) +
      '.pem',
    'https://127.0.0.1/key.pem',
    'https://[::1]/key.pem',
    'https://sns.us-east-2.amazonaws.com/key.pem',
    'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-' +
      'a'.repeat(32) +
      '.pem?redirect=http://127.0.0.1',
    'https://sns.us-east-2.amazonaws.com:444/SimpleNotificationService-' +
      'a'.repeat(32) +
      '.pem',
  ])('refuses unsafe certificate URL %s before DNS/HTTP', async (url) => {
    const { verifier, fetcher } = setup();
    await expect(
      verifier.authenticate(fixture.envelope({}, { SigningCertURL: url })),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });
  it.each([
    'arn:aws:sns:us-east-2:999999999999:orbit-test-feedback',
    'arn:aws:sns:us-east-1:123456789012:orbit-test-feedback',
    'arn:aws:sns:us-east-2:123456789012:other',
  ])('refuses foreign topic/account/region %s', async (TopicArn) => {
    const { verifier, fetcher } = setup();
    await expect(
      verifier.authenticate(fixture.envelope({}, { TopicArn })),
    ).rejects.toMatchObject({ code: 'SNS_TOPIC_DENIED' });
    expect(fetcher.fetch).not.toHaveBeenCalled();
  });
  it('fails closed for legacy v1, newline injection, bad certificate and stale/future timestamps', async () => {
    const { verifier, fetcher } = setup();
    const input = fixture.envelope({});
    await expect(
      verifier.authenticate({ ...input, SignatureVersion: '1' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      verifier.authenticate({
        ...input,
        Timestamp: input.Timestamp + '\nType\nNotification',
      }),
    ).rejects.toMatchObject({ status: 400 });
    for (const delta of [-33 * 86_400_000, 600_000])
      await expect(
        verifier.authenticate(
          fixture.envelope(
            {},
            { Timestamp: new Date(Date.now() + delta).toISOString() },
          ),
        ),
      ).rejects.toMatchObject({ code: 'SNS_TIMESTAMP_INVALID' });
    fetcher.fetch.mockResolvedValue('not a certificate');
    await expect(verifier.authenticate(input)).rejects.toMatchObject({
      code: 'SNS_CERTIFICATE_INVALID',
    });
  });
  it('accepts an authentic delayed retry while the certificate remains valid', async () => {
    const { verifier } = setup(),
      input = fixture.envelope({});
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 3 * 86_400_000);
    try {
      await expect(verifier.authenticate(input)).resolves.toMatchObject({
        envelope: input,
      });
    } finally {
      clock.mockRestore();
    }
  });
  it('does not retain an expired certificate and rejects expired signing keys', async () => {
    const { verifier } = setup(),
      input = fixture.envelope({});
    await verifier.authenticate(input);
    const clock = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 11 * 86_400_000);
    try {
      await expect(verifier.authenticate(input)).rejects.toMatchObject({
        code: 'SNS_CERTIFICATE_INVALID',
      });
    } finally {
      clock.mockRestore();
    }
  });
  it('binds SubscriptionConfirmation URL/token/topic without fetching it', async () => {
    const { verifier, fetcher } = setup();
    const token = 'synthetic-confirmation-token';
    const url = new URL(`https://sns.${fixture.config.region}.amazonaws.com/`);
    url.searchParams.set('Action', 'ConfirmSubscription');
    url.searchParams.set('TopicArn', fixture.config.topicArn);
    url.searchParams.set('Token', token);
    const input = fixture.envelope('confirmar', {
      Type: 'SubscriptionConfirmation',
      Token: token,
      SubscribeURL: url.href,
    });
    await expect(verifier.authenticate(input)).resolves.toMatchObject({
      envelope: input,
    });
    for (const SubscribeURL of [
      'http://127.0.0.1/',
      url.href + '&Token=extra',
      url.href.replace(token, 'outro'),
    ])
      await expect(
        verifier.authenticate(fixture.resign({ ...input, SubscribeURL })),
      ).rejects.toMatchObject({ status: 403 });
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
  });
  it('coalesces certificate fetches and retries transport failures', async () => {
    const { verifier, fetcher } = setup();
    let release: (value: string) => void = () => undefined;
    fetcher.fetch.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const input = fixture.envelope({});
    const first = verifier.authenticate(input);
    const shared = verifier.authenticate(input);
    expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    release(fixture.certificate);
    await Promise.all([first, shared]);
    const bad = fixture.envelope(
      {},
      {
        SigningCertURL: input.SigningCertURL.replace(
          'a'.repeat(32),
          'b'.repeat(32),
        ),
      },
    );
    fetcher.fetch.mockRejectedValueOnce(new Error('SECRET_NETWORK_ERROR'));
    await expect(verifier.authenticate(bad)).rejects.toThrow();
    fetcher.fetch.mockResolvedValue(fixture.certificate);
    await expect(verifier.authenticate(bad)).resolves.toBeDefined();
  });
  it('bounds distinct in-flight certificate requests to four', async () => {
    const { verifier, fetcher } = setup();
    const releases: ((certificate: string) => void)[] = [];
    fetcher.fetch.mockImplementation(
      () => new Promise<string>((resolve) => releases.push(resolve)),
    );
    const messages = [1, 2, 3, 4, 5].map((n) =>
      fixture.envelope(
        {},
        {
          SigningCertURL: `https://sns.us-east-2.amazonaws.com/SimpleNotificationService-${String(n).padStart(32, '0')}.pem`,
        },
      ),
    );
    const pending = messages.slice(0, 4).map((m) => verifier.authenticate(m));
    try {
      await expect(verifier.authenticate(messages[4]!)).rejects.toMatchObject({
        code: 'SNS_CERTIFICATE_BUSY',
      });
      expect(fetcher.fetch).toHaveBeenCalledTimes(4);
    } finally {
      releases.forEach((resolve) => resolve(fixture.certificate));
      await Promise.all(pending);
    }
  });
  it('evicts certificate entries beyond its bounded cache', async () => {
    const { verifier, fetcher } = setup();
    const messages = Array.from({ length: 17 }, (_, n) =>
      fixture.envelope(
        {},
        {
          SigningCertURL: `https://sns.us-east-2.amazonaws.com/SimpleNotificationService-${String(n).padStart(32, '0')}.pem`,
        },
      ),
    );
    for (const message of messages) await verifier.authenticate(message);
    await verifier.authenticate(messages[0]!);
    expect(fetcher.fetch).toHaveBeenCalledTimes(18);
  });
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.1.1',
    '192.168.0.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    'fd00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])('never permits DNS to route to nonpublic address %s', (ip) =>
    expect(isPublicSnsAddress(ip)).toBe(false),
  );
  it.each(['3.120.1.1', '52.95.0.1', '2600:9000::1'])(
    'permits global address %s',
    (ip) => expect(isPublicSnsAddress(ip)).toBe(true),
  );
  it('requires explicit deployment identity and configuration-set when enabled', () => {
    const env = {
      AWS_SES_FEEDBACK_ENABLED: 'true',
      AWS_REGION: fixture.config.region,
      AWS_SES_FEEDBACK_ACCOUNT_ID: fixture.config.accountId,
      AWS_SES_FEEDBACK_TOPIC_ARN: fixture.config.topicArn,
      AWS_SES_FEEDBACK_IDENTITY_ARN: fixture.config.identityArn,
      AWS_SES_FROM_EMAIL: fixture.config.from,
      AWS_SES_CONFIGURATION_SET: 'orbit-test',
      EMAIL_SUPPRESSION_HASH_KEY: fixture.config.hashKey,
    };
    expect(sesFeedbackConfiguration(env)).toEqual(fixture.config);
    expect(() =>
      sesFeedbackConfiguration({
        ...env,
        AWS_SES_FEEDBACK_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:x',
      }),
    ).toThrow();
    expect(() =>
      sesFeedbackConfiguration({ ...env, AWS_SES_CONFIGURATION_SET: '' }),
    ).toThrow();
    expect(() =>
      sesFeedbackConfiguration({ ...env, AWS_SES_FEEDBACK_ENABLED: 'yes' }),
    ).toThrow();
  });
});
