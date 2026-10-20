import { InfrastructureException } from './exceptions';
import { validateReleaseEnvironment } from './release-environment';

const valid = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'j'.repeat(48),
  TRIAL_FINGERPRINT_SECRET: 't'.repeat(48),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  FRONTEND_ORIGIN: 'https://app.example.test',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  EMAIL_FROM: 'Orbit <no-reply@example.test>',
  IDENTITY_PUBLIC_WEB_URL: 'https://app.example.test',
});

describe('release environment', () => {
  it('accepts explicit production secrets and origins', () => {
    expect(() => validateReleaseEnvironment(valid())).not.toThrow();
  });

  it.each([
    'JWT_ACCESS_SECRET',
    'TRIAL_FINGERPRINT_SECRET',
    'ENCRYPTION_KEY',
    'FRONTEND_ORIGIN',
    'SMTP_HOST',
    'EMAIL_FROM',
    'IDENTITY_PUBLIC_WEB_URL',
  ])('fails closed when %s is missing', (key) => {
    const environment = valid();
    delete environment[key];
    expect(() => validateReleaseEnvironment(environment)).toThrow(
      InfrastructureException,
    );
  });

  it('rejects incomplete SMTP auth and insecure public identity URLs', () => {
    expect(() =>
      validateReleaseEnvironment({ ...valid(), SMTP_USER: 'orbit' }),
    ).toThrow(/configured together/);
    expect(() =>
      validateReleaseEnvironment({
        ...valid(),
        IDENTITY_PUBLIC_WEB_URL: 'http://app.example.test',
      }),
    ).toThrow(/HTTPS/);
  });

  it('rejects wildcard and non-TLS external origins', () => {
    expect(() =>
      validateReleaseEnvironment({ ...valid(), FRONTEND_ORIGIN: '*' }),
    ).toThrow(/explicit/);
    expect(() =>
      validateReleaseEnvironment({
        ...valid(),
        FRONTEND_ORIGIN: 'http://app.example.test',
      }),
    ).toThrow(/HTTPS/);
  });

  it('never includes secret values in its error', () => {
    const canary = 'must-not-appear';
    expect(() =>
      validateReleaseEnvironment({
        ...valid(),
        TRIAL_FINGERPRINT_SECRET: canary,
      }),
    ).toThrow(/TRIAL_FINGERPRINT_SECRET/);
    try {
      validateReleaseEnvironment({
        ...valid(),
        TRIAL_FINGERPRINT_SECRET: canary,
      });
    } catch (error) {
      expect((error as Error).message).not.toContain(canary);
    }
  });
});
