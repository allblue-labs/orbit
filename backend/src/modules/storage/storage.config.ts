/**
 * Configuração do armazenamento.
 *
 * Lida uma vez, na composição do módulo. Nenhum serviço de domínio lê variável
 * de ambiente — é o que permite trocar de provider sem tocar em domínio.
 */
import { InfrastructureException } from '../../exceptions';
import { STORAGE_PROVIDERS, type StorageProviderName } from './storage.types';

export interface StorageConfig {
  readonly provider: StorageProviderName;
  readonly bucket: string;
  /** Validade padrão das URLs assinadas. */
  readonly signedUrlTtlSeconds: number;
  /** Raiz do sistema de arquivos — só para `LOCAL`. */
  readonly localRoot: string;
  /**
   * URL pública da API para o gateway de upload assinado.
   *
   * O provider local não tem object store: quem serve o arquivo é a própria
   * API, na rota de download assinado. Esta base é o endereço externo dela.
   */
  readonly localPublicBaseUrl: string;
  /** Segredo do gateway assinado (e de downloads LOCAL em desenvolvimento). */
  readonly localSigningSecret: string;
  readonly s3?: S3Config;
  readonly publicUrl?: string;
  readonly publicBucket?: string;
  readonly privateBucket?: string;
}

export interface S3Config {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /**
   * MinIO e a maioria dos compatíveis exigem caminho
   * (`https://host/bucket/key`); a AWS usa subdomínio.
   */
  readonly forcePathStyle: boolean;
  readonly legacyBucketAliases?: Readonly<Record<string, string>>;
}

const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;

function required(key: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[key]?.trim();
  if (!value) {
    throw new InfrastructureException(
      `Storage configuration is incomplete: ${key} is required`,
    );
  }
  return value;
}

function number(
  key: string,
  fallback: number,
  environment: NodeJS.ProcessEnv,
): number {
  const raw = environment[key]?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): StorageConfig {
  const raw = (environment.STORAGE_PROVIDER ?? 'R2').trim().toUpperCase();
  if (!STORAGE_PROVIDERS.includes(raw as StorageProviderName)) {
    throw new InfrastructureException(
      `Unsupported STORAGE_PROVIDER "${raw}". Supported: ${STORAGE_PROVIDERS.join(', ')}`,
    );
  }
  const provider = raw as StorageProviderName;
  if (provider === 'LOCAL' && environment.NODE_ENV === 'production')
    throw new InfrastructureException(
      'LOCAL storage is disabled in production; configure R2',
    );
  let r2: S3Config | undefined;
  let publicUrl: string | undefined;
  let privateBucket: string | undefined;
  if (provider === 'R2') {
    const account = required('R2_ACCOUNT_ID', environment);
    if (!/^[a-f0-9]{32}$/.test(account))
      throw new InfrastructureException(
        'R2_ACCOUNT_ID must be a Cloudflare account ID',
      );
    const endpoint = required('R2_ENDPOINT', environment);
    if (endpoint !== `https://${account}.r2.cloudflarestorage.com`)
      throw new InfrastructureException(
        'R2_ENDPOINT must match the HTTPS endpoint of R2_ACCOUNT_ID',
      );
    publicUrl = required('R2_PUBLIC_URL', environment).replace(/\/+$/, '');
    let url: URL;
    try {
      url = new URL(publicUrl);
    } catch {
      throw new InfrastructureException(
        'R2_PUBLIC_URL must be a valid HTTPS origin',
      );
    }
    if (url.protocol !== 'https:' || url.origin !== publicUrl)
      throw new InfrastructureException(
        'R2_PUBLIC_URL must be an HTTPS origin',
      );
    const bucket = required('R2_BUCKET_NAME', environment);
    privateBucket = required('R2_PRIVATE_BUCKET_NAME', environment);
    if (privateBucket === bucket)
      throw new InfrastructureException(
        'R2_PRIVATE_BUCKET_NAME must differ from the public bucket',
      );
    for (const value of [bucket, privateBucket])
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value))
        throw new InfrastructureException('R2 bucket names are invalid');
    r2 = {
      endpoint,
      region: 'auto',
      accessKeyId: required('R2_ACCESS_KEY_ID', environment),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY', environment),
      forcePathStyle: true,
      legacyBucketAliases: Object.fromEntries(
        (environment.R2_LEGACY_PRIVATE_BUCKETS ?? 'orbit-artifacts,documents')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => [x, privateBucket!]),
      ),
    };
  }

  if (provider === 'AZURE_BLOB' || provider === 'GCS') {
    throw new InfrastructureException(
      `STORAGE_PROVIDER "${provider}" is declared in the contract but not implemented yet`,
    );
  }

  const ttl = Math.min(
    number('STORAGE_SIGNED_URL_TTL_SECONDS', DEFAULT_TTL_SECONDS, environment),
    MAX_TTL_SECONDS,
  );

  return {
    provider,
    bucket:
      privateBucket ??
      (environment.STORAGE_BUCKET?.trim() || 'orbit-artifacts'),
    privateBucket,
    publicUrl,
    publicBucket:
      provider === 'R2' ? required('R2_BUCKET_NAME', environment) : undefined,
    signedUrlTtlSeconds: ttl,
    localRoot: environment.STORAGE_LOCAL_DIR?.trim() || 'storage/objects',
    localPublicBaseUrl:
      environment.STORAGE_PUBLIC_API_URL?.trim() ||
      (environment.IDENTITY_PUBLIC_WEB_URL?.trim()
        ? `${environment.IDENTITY_PUBLIC_WEB_URL.trim()}/api/v1`
        : '') ||
      environment.STORAGE_LOCAL_PUBLIC_URL?.trim() ||
      'http://localhost:6001/api/v1',
    /**
     * Sem segredo dedicado, a assinatura local reaproveita o segredo do JWT —
     * já obrigatório e do mesmo nível de sensibilidade. Nunca há assinatura
     * com valor fixo no código.
     */
    localSigningSecret:
      environment.STORAGE_LOCAL_SIGNING_SECRET?.trim() ||
      required('JWT_ACCESS_SECRET', environment),
    s3:
      r2 ??
      (provider === 'S3' || provider === 'MINIO'
        ? {
            endpoint: required('STORAGE_S3_ENDPOINT', environment).replace(
              /\/+$/,
              '',
            ),
            region: environment.STORAGE_S3_REGION?.trim() || 'us-east-1',
            accessKeyId: required('STORAGE_S3_ACCESS_KEY_ID', environment),
            secretAccessKey: required(
              'STORAGE_S3_SECRET_ACCESS_KEY',
              environment,
            ),
            forcePathStyle:
              (environment.STORAGE_S3_FORCE_PATH_STYLE ?? 'true').trim() !==
              'false',
          }
        : undefined),
  };
}

export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');
