import { InfrastructureException } from './exceptions';
import { validateReleaseEnvironment } from './release-environment';

const valid = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DATABASE_URL:
    'postgresql://orbit_app:synthetic-password@pgbouncer:6432/orbit?pgbouncer=true',
  JWT_ACCESS_SECRET: 'j'.repeat(48),
  TRIAL_FINGERPRINT_SECRET: 't'.repeat(48),
  AUTH_RATE_LIMIT_SECRET: 'r'.repeat(48),
  TRUSTED_PROXY_SECRET: 'p'.repeat(48),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  EMAIL_SUPPRESSION_HASH_KEY: Buffer.alloc(32, 11).toString('base64'),
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
  it.each([
    'DIRECT_DATABASE_URL',
    'APP_DATABASE_URL',
    'POSTGRES_PASSWORD',
    'PLATFORM_ADMIN_PASSWORD',
    'OWNER_PASSWORD',
  ])('recusa a credencial administrativa %s sem expor seu valor', (key) => {
    const value = 'private-canary-must-never-appear';
    try {
      validateReleaseEnvironment({ ...valid(), [key]: value });
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as Error).message).toContain(key);
      expect((error as Error).message).not.toContain(value);
    }
  });
  it.each([
    '',
    'not-a-url',
    'https://user:password@localhost/db',
    'postgresql://localhost/db',
  ])('exige conexão explícita do papel restrito: %s', (url) => {
    expect(() =>
      validateReleaseEnvironment({ ...valid(), DATABASE_URL: url }),
    ).toThrow('DATABASE_URL');
  });
  it('não permite desativar a verificação do papel em produção', () => {
    expect(() =>
      validateReleaseEnvironment({
        ...valid(),
        DATABASE_ENFORCE_RESTRICTED_ROLE: 'false',
      }),
    ).toThrow('DATABASE_ENFORCE_RESTRICTED_ROLE');
  });
  it('only starts production retention with an explicit purge configuration', () => {
    const enabled = { ...valid(), SUBSCRIPTION_DATA_RETENTION_ENABLED: 'true' };
    expect(() => validateReleaseEnvironment(enabled)).toThrow(
      'Cloudflare cache purge',
    );
    expect(() =>
      validateReleaseEnvironment({
        ...enabled,
        CLOUDFLARE_CACHE_PURGE_ZONE_ID: '1'.repeat(32),
        CLOUDFLARE_CACHE_PURGE_TOKEN: 'fixture',
      }),
    ).not.toThrow();
    expect(() =>
      validateReleaseEnvironment({ ...enabled, ORBIT_DEPLOYMENT: 'staging' }),
    ).not.toThrow();
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
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'TRIAL_FINGERPRINT_SECRET',
    'AUTH_RATE_LIMIT_SECRET',
    'TRUSTED_PROXY_SECRET',
    'ENCRYPTION_KEY',
    'EMAIL_SUPPRESSION_HASH_KEY',
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

describe('outbound deployment policy preflight', () => {
  it('fails production startup on dangerous private-route configuration', () => {
    expect(() =>
      validateReleaseEnvironment({
        ...valid(),
        OUTBOUND_AI_PRIVATE_ROUTES:
          '[{"origin":"https://internal","addresses":["169.254.169.254"]}]',
      }),
    ).toThrow('Invalid outbound HTTP destination policy');
  });
});
