import { InfrastructureException } from './exceptions';
import { validateReleaseEnvironment } from './release-environment';

const valid = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: 'j'.repeat(48),
  TRIAL_FINGERPRINT_SECRET: 't'.repeat(48),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  FRONTEND_ORIGIN: 'https://app.example.test',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'environment-access-key',
  AWS_SECRET_ACCESS_KEY: 'environment-secret-key',
  AWS_SES_FROM_EMAIL: 'no-reply@example.test',
  IDENTITY_PUBLIC_WEB_URL: 'https://app.example.test',
});

describe('release environment', () => {
  it.each(['sa-east-1', 'us-east-1', 'us-east-2', 'eu-west-1'])(
    'aceita o código regional %s também quando há espaços ao redor',
    (region) => {
      expect(() =>
        validateReleaseEnvironment({ ...valid(), AWS_REGION: ` ${region} ` }),
      ).not.toThrow();
    },
  );
  it.each([
    'South America (São Paulo)',
    'https://email.sa-east-1.amazonaws.com',
    'SA_EAST_1',
  ])('explica o formato esperado para AWS_REGION inválida: %s', (region) => {
    expect(() =>
      validateReleaseEnvironment({ ...valid(), AWS_REGION: region }),
    ).toThrow(/código da região do SES, como sa-east-1 ou us-east-1/);
  });
  it('SES utiliza somente as credenciais explícitas de ambiente', () => {
    expect(() =>
      validateReleaseEnvironment({ ...valid(), AWS_PROFILE: 'ignored' }),
    ).not.toThrow();
  });
  it.each([
    'AWS_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SES_FROM_EMAIL',
  ])('SES exige %s em produção', (key) => {
    const env = valid();
    delete env[key];
    expect(() => validateReleaseEnvironment(env)).toThrow(key);
  });
  it('recusa remetente inválido e região inválida', () => {
    expect(() =>
      validateReleaseEnvironment({ ...valid(), AWS_SES_FROM_EMAIL: 'invalid' }),
    ).toThrow(/AWS_SES_FROM_EMAIL/);
    expect(() =>
      validateReleaseEnvironment({ ...valid(), AWS_REGION: 'invalid' }),
    ).toThrow(/AWS_REGION/);
  });
  it('accepts explicit production secrets and origins', () => {
    expect(() => validateReleaseEnvironment(valid())).not.toThrow();
  });

  it.each([
    'JWT_ACCESS_SECRET',
    'TRIAL_FINGERPRINT_SECRET',
    'ENCRYPTION_KEY',
    'FRONTEND_ORIGIN',
    'IDENTITY_PUBLIC_WEB_URL',
  ])('fails closed when %s is missing', (key) => {
    const environment = valid();
    delete environment[key];
    expect(() => validateReleaseEnvironment(environment)).toThrow(
      InfrastructureException,
    );
  });

  it('rejects insecure public identity URLs', () => {
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
