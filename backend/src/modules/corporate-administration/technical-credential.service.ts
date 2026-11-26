import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

export const CONNECTION_READ = 'connection:read';
export type CorporateCapability = typeof CONNECTION_READ;
type Deployment = 'local' | 'staging' | 'production';

export interface TechnicalPrincipal {
  readonly id: string;
  readonly capabilities: readonly CorporateCapability[];
}

interface Credential {
  readonly digest: Buffer;
  readonly expiresAt: number;
  readonly revoked: boolean;
  readonly principal: TechnicalPrincipal;
}

interface Configuration {
  readonly environment: Deployment;
  readonly credentials: ReadonlyMap<string, Credential>;
}

const KEY_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const PRINCIPAL_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[47][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TOKEN =
  /^orbit-ca1\.(local|staging|production)\.([a-z0-9][a-z0-9_-]{0,31})\.([A-Za-z0-9_-]{43})$/;
const DUMMY_DIGEST = Buffer.alloc(32);
const CREDENTIAL_FIELDS = [
  'keyId',
  'principalId',
  'environment',
  'secretSha256',
  'expiresAt',
  'revoked',
  'capabilities',
];

@Injectable()
export class TechnicalCredentialService {
  private readonly configuration: Configuration | null;

  constructor() {
    this.configuration = readConfiguration(process.env);
    if (
      process.env.ORBIT_CORPORATE_ADMIN_ENABLED === 'true' &&
      !this.configuration
    ) {
      new Logger(TechnicalCredentialService.name).warn({
        event: 'corporate_admin_config',
        outcome: 'disabled',
        code: 'INVALID_CONFIGURATION',
      });
    }
  }

  get environment(): Deployment | undefined {
    return this.configuration?.environment;
  }

  authenticate(
    header: string | undefined,
    now = Date.now(),
  ): TechnicalPrincipal | null {
    const config = this.configuration;
    if (
      !config ||
      !header ||
      header.length > 110 ||
      header.slice(0, 7).toLowerCase() !== 'bearer '
    )
      return null;
    const match = TOKEN.exec(header.slice(7));
    if (!match) return null;
    const environment = match[1]!;
    const keyId = match[2]!;
    const secret = match[3]!;
    const credential = config.credentials.get(keyId);
    const candidate = createHash('sha256')
      .update(
        'orbit-corporate-admin.v1\0' +
          environment +
          '\0' +
          keyId +
          '\0' +
          secret,
      )
      .digest();
    const matches = timingSafeEqual(
      candidate,
      credential?.digest ?? DUMMY_DIGEST,
    );
    if (
      !matches ||
      !credential ||
      environment !== config.environment ||
      credential.revoked ||
      now >= credential.expiresAt
    )
      return null;
    return credential.principal;
  }
}

function readConfiguration(env: NodeJS.ProcessEnv): Configuration | null {
  if (env.ORBIT_CORPORATE_ADMIN_ENABLED !== 'true') return null;
  const declared = env.ORBIT_DEPLOYMENT;
  const environment: Deployment | null =
    declared === 'staging' || declared === 'production'
      ? declared
      : declared === undefined && env.NODE_ENV !== 'production'
        ? 'local'
        : null;
  const raw = env.ORBIT_CORPORATE_ADMIN_CREDENTIALS;
  if (!environment || !raw || raw.length > 16_384) return null;

  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(input) || input.length < 1 || input.length > 16)
    return null;

  const credentials = new Map<string, Credential>();
  for (const item of input as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const fields = Object.keys(item);
    if (
      fields.length !== CREDENTIAL_FIELDS.length ||
      !fields.every((field) => CREDENTIAL_FIELDS.includes(field))
    )
      return null;
    const {
      keyId,
      principalId,
      environment: bound,
      secretSha256,
      expiresAt,
      revoked,
      capabilities,
    } = item as Record<string, unknown>;
    if (
      typeof keyId !== 'string' ||
      !KEY_ID.test(keyId) ||
      credentials.has(keyId) ||
      typeof principalId !== 'string' ||
      !PRINCIPAL_ID.test(principalId) ||
      bound !== environment ||
      typeof secretSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(secretSha256) ||
      typeof revoked !== 'boolean' ||
      !Array.isArray(capabilities) ||
      capabilities.length > 1 ||
      (capabilities.length === 1 && capabilities[0] !== CONNECTION_READ)
    )
      return null;
    const expiry = utcExpiry(expiresAt);
    if (expiry === null) return null;
    const granted: CorporateCapability[] = capabilities.length
      ? [CONNECTION_READ]
      : [];
    credentials.set(keyId, {
      digest: Buffer.from(secretSha256, 'hex'),
      expiresAt: expiry,
      revoked,
      principal: Object.freeze({
        id: principalId,
        capabilities: Object.freeze(granted),
      }),
    });
  }
  return { environment, credentials };
}

function utcExpiry(value: unknown): number | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const iso = new Date(time).toISOString();
  return value === iso || value === iso.replace('.000Z', 'Z') ? time : null;
}
