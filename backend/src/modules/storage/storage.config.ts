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
   * Base pública das URLs assinadas do provider `LOCAL`.
   *
   * O provider local não tem object store: quem serve o arquivo é a própria
   * API, na rota de download assinado. Esta base é o endereço externo dela.
   */
  readonly localPublicBaseUrl: string;
  /** Segredo que assina as URLs do provider `LOCAL`. */
  readonly localSigningSecret: string;
  readonly s3?: S3Config;
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
}

const DEFAULT_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 3600;

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new InfrastructureException(
      `Storage configuration is incomplete: ${key} is required`,
    );
  }
  return value;
}

function number(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadStorageConfig(): StorageConfig {
  const raw = (process.env.STORAGE_PROVIDER ?? 'LOCAL').trim().toUpperCase();
  if (!STORAGE_PROVIDERS.includes(raw as StorageProviderName)) {
    throw new InfrastructureException(
      `Unsupported STORAGE_PROVIDER "${raw}". Supported: ${STORAGE_PROVIDERS.join(', ')}`,
    );
  }
  const provider = raw as StorageProviderName;

  if (provider === 'AZURE_BLOB' || provider === 'GCS') {
    throw new InfrastructureException(
      `STORAGE_PROVIDER "${provider}" is declared in the contract but not implemented yet`,
    );
  }

  const ttl = Math.min(
    number('STORAGE_SIGNED_URL_TTL_SECONDS', DEFAULT_TTL_SECONDS),
    MAX_TTL_SECONDS,
  );

  return {
    provider,
    bucket: process.env.STORAGE_BUCKET?.trim() || 'orbit-artifacts',
    signedUrlTtlSeconds: ttl,
    localRoot: process.env.STORAGE_LOCAL_DIR?.trim() || 'storage/objects',
    localPublicBaseUrl:
      process.env.STORAGE_LOCAL_PUBLIC_URL?.trim() ||
      'http://localhost:6001/api/v1',
    /**
     * Sem segredo dedicado, a assinatura local reaproveita o segredo do JWT —
     * já obrigatório e do mesmo nível de sensibilidade. Nunca há assinatura
     * com valor fixo no código.
     */
    localSigningSecret:
      process.env.STORAGE_LOCAL_SIGNING_SECRET?.trim() ||
      required('JWT_ACCESS_SECRET'),
    s3:
      provider === 'S3' || provider === 'MINIO'
        ? {
            endpoint: required('STORAGE_S3_ENDPOINT').replace(/\/+$/, ''),
            region: process.env.STORAGE_S3_REGION?.trim() || 'us-east-1',
            accessKeyId: required('STORAGE_S3_ACCESS_KEY_ID'),
            secretAccessKey: required('STORAGE_S3_SECRET_ACCESS_KEY'),
            forcePathStyle:
              (process.env.STORAGE_S3_FORCE_PATH_STYLE ?? 'true').trim() !==
              'false',
          }
        : undefined,
  };
}

export const STORAGE_CONFIG = Symbol('STORAGE_CONFIG');
