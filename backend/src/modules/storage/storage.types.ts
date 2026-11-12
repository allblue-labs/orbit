/**
 * Contrato do provider de armazenamento.
 *
 * A plataforma inteira depende **apenas desta interface**. Nenhum módulo de
 * domínio conhece bucket, caminho, credencial ou SDK: pede um objeto, uma URL
 * assinada ou um hash, e recebe.
 *
 * ## Por que a assinatura é a operação central
 *
 * Um documento emitido pode ter dezenas de megabytes. Fazer o binário passar
 * pela API em toda leitura transformaria o Orbit em proxy de arquivos — custo
 * de banda dobrado, memória do processo presa e nenhum ganho. As URLs
 * assinadas deixam o transporte acontecer **direto entre o cliente e o object
 * store**, com prazo curto e escopo de um único objeto.
 *
 * O backend continua sendo o único a decidir **se** aquele acesso pode
 * acontecer: a URL só é emitida depois de RLS, capability e permissão.
 *
 * ## Implementações
 *
 * | Provider     | Situação                                        |
 * | ------------ | ----------------------------------------------- |
 * | `R2`         | padrão; SDK AWS S3 v3, buckets público/privado    |
 * | `LOCAL`      | somente desenvolvimento/testes                 |
 * | `S3`/`MINIO` | S3 Compatible — mesma implementação, SigV4      |
 * | `AZURE_BLOB` | futura: implementar esta interface              |
 * | `GCS`        | futura: implementar esta interface              |
 *
 * Azure e GCS não estão implementados. Ambos assinam URL por mecanismo próprio
 * (SAS e V4 signed URL), e é exatamente por isso que a assinatura é uma
 * operação do provider e não uma função utilitária compartilhada.
 */

export const STORAGE_PROVIDERS = [
  'R2',
  'LOCAL',
  'S3',
  'MINIO',
  'AZURE_BLOB',
  'GCS',
] as const;
export type StorageProviderName = (typeof STORAGE_PROVIDERS)[number];

/** Referência interna a um objeto. Nunca sai em Read Model. */
export interface StorageObjectRef {
  readonly bucket: string;
  readonly objectKey: string;
}

export interface PutObjectInput extends StorageObjectRef {
  readonly body: Buffer;
  readonly mimeType: string;
  readonly cacheControl?: string;
  /** Metadados do provider (`x-amz-meta-*` no S3). */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface ObjectStat extends StorageObjectRef {
  readonly sizeBytes: number;
  readonly mimeType: string | null;
}

export type SignedUrlOperation = 'download' | 'preview' | 'upload';

export interface SignedUrlRequest extends StorageObjectRef {
  readonly operation: SignedUrlOperation;
  readonly expiresInSeconds: number;
  /**
   * Nome sugerido ao salvar. Só faz sentido em `download` — é o que decide
   * entre baixar e abrir no navegador.
   */
  readonly fileName?: string;
  readonly mimeType?: string;
}

export interface SignedUrl {
  readonly url: string;
  readonly expiresAt: Date;
  readonly method: 'GET' | 'PUT';
  /** Cabeçalhos que o cliente **precisa** repetir para a assinatura valer. */
  readonly requiredHeaders: Readonly<Record<string, string>>;
}

/**
 * Provider de armazenamento.
 *
 * Implementações não conhecem organização, execução ou manifest: recebem
 * bucket e chave já resolvidos. Autorização e multi-tenancy ficam no domínio.
 */
export interface StorageProvider {
  readonly name: StorageProviderName;
  /** Bucket usado quando o chamador não informa outro. */
  readonly defaultBucket: string;

  put(input: PutObjectInput): Promise<ObjectStat>;
  get(ref: StorageObjectRef): Promise<Buffer>;
  head(ref: StorageObjectRef): Promise<ObjectStat | null>;
  remove(ref: StorageObjectRef): Promise<void>;
  sign(request: SignedUrlRequest): Promise<SignedUrl>;
}

/** Token de injeção — o domínio depende disto, nunca de uma classe concreta. */
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
