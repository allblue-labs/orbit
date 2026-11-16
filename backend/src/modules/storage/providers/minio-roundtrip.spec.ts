/**
 * Round-trip real contra um object store S3 Compatible.
 *
 * Assinatura correta não é a mesma coisa que assinatura **aceita**. O teste de
 * unidade prova que o algoritmo produz o que a especificação descreve; só um
 * servidor prova que o servidor concorda. Foi este teste que revelou dois
 * defeitos reais:
 *
 * 1. cabeçalhos `x-amz-meta-*` não assinados eram recusados com 400;
 * 2. assinar como `GET` e requisitar `HEAD` era recusado com 403 — o método
 *    faz parte do canonical request.
 *
 * ## Como executar
 *
 * ```bash
 * docker run -d --rm --name orbit-minio -p 9210:9000 \
 *   -e MINIO_ROOT_USER=orbitkey -e MINIO_ROOT_PASSWORD=orbitsecret123 \
 *   minio/minio server /data
 * docker run --rm --network host --entrypoint sh minio/mc -c \
 *   "mc alias set local http://localhost:9210 orbitkey orbitsecret123 && \
 *    mc mb --ignore-existing local/orbit-artifacts"
 * npm test -- minio-roundtrip
 * ```
 *
 * Sem MinIO no ar a suíte é **pulada**, não quebrada: o teste depende de
 * infraestrutura externa e não deve reprovar um build que não a tem.
 */
import { createHash, randomUUID } from 'node:crypto';
import { S3CompatibleStorageProvider } from './s3-compatible.storage';

const ENDPOINT = process.env.MINIO_TEST_ENDPOINT ?? 'http://localhost:9210';
const BUCKET = 'orbit-artifacts';

const config = {
  endpoint: ENDPOINT,
  region: 'us-east-1',
  accessKeyId: process.env.MINIO_TEST_ACCESS_KEY ?? 'orbitkey',
  secretAccessKey: process.env.MINIO_TEST_SECRET_KEY ?? 'orbitsecret123',
  forcePathStyle: true,
};

async function reachable(): Promise<boolean> {
  try {
    await fetch(ENDPOINT, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

describe('S3CompatibleStorageProvider contra MinIO', () => {
  const provider = new S3CompatibleStorageProvider('MINIO', BUCKET, config);
  const objectKey = `qa/${randomUUID()}.txt`;
  const body = Buffer.from('documento oficial do Orbit — PR-19');
  let available = false;

  beforeAll(async () => {
    available = await reachable();
    if (!available) {
      console.warn(
        `[storage] MinIO indisponível em ${ENDPOINT}; round-trip pulado.`,
      );
    }
  });

  const online = (name: string, run: () => Promise<void>): void => {
    it(
      name,
      async () => {
        if (!available) return;
        await run();
      },
      20000,
    );
  };

  online('grava e lê o mesmo conteúdo, byte a byte', async () => {
    const stat = await provider.put({
      bucket: BUCKET,
      objectKey,
      body,
      mimeType: 'text/plain',
    });
    expect(stat.sizeBytes).toBe(body.length);

    const read = await provider.get({ bucket: BUCKET, objectKey });
    expect(createHash('sha256').update(read).digest('hex')).toBe(
      createHash('sha256').update(body).digest('hex'),
    );
  });

  online('consulta metadados sem baixar o objeto', async () => {
    const stat = await provider.head({ bucket: BUCKET, objectKey });
    expect(stat?.sizeBytes).toBe(body.length);
  });

  online('devolve null para objeto inexistente', async () => {
    const stat = await provider.head({
      bucket: BUCKET,
      objectKey: `qa/${randomUUID()}.txt`,
    });
    expect(stat).toBeNull();
  });

  online('emite URL de download que o servidor aceita', async () => {
    const signed = await provider.sign({
      bucket: BUCKET,
      objectKey,
      operation: 'download',
      expiresInSeconds: 120,
      fileName: 'documento.txt',
      mimeType: 'text/plain',
    });

    const response = await fetch(signed.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe(
      body.toString(),
    );
  });

  online('emite URL de preview que abre no navegador', async () => {
    const signed = await provider.sign({
      bucket: BUCKET,
      objectKey,
      operation: 'preview',
      expiresInSeconds: 120,
      mimeType: 'text/plain',
    });

    const response = await fetch(signed.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('inline');
  });

  online(
    'refuses direct upload URLs and overwriting stored bytes',
    async () => {
      await expect(
        provider.sign({
          bucket: BUCKET,
          objectKey,
          operation: 'upload',
          expiresInSeconds: 120,
        }),
      ).rejects.toThrow();
      await expect(
        provider.put({
          bucket: BUCKET,
          objectKey,
          body: Buffer.from('overwrite'),
          mimeType: 'text/plain',
        }),
      ).rejects.toThrow();
      expect(await provider.get({ bucket: BUCKET, objectKey })).toEqual(body);
    },
  );

  online('recusa assinatura adulterada', async () => {
    const signed = await provider.sign({
      bucket: BUCKET,
      objectKey,
      operation: 'download',
      expiresInSeconds: 120,
    });
    const tampered = signed.url.replace(
      /X-Amz-Signature=.{8}/,
      'X-Amz-Signature=00000000',
    );
    expect((await fetch(tampered)).status).toBe(403);
  });

  online('recusa assinatura expirada', async () => {
    const signed = await provider.sign({
      bucket: BUCKET,
      objectKey,
      operation: 'download',
      /** O menor prazo aceito pela especificação é um segundo. */
      expiresInSeconds: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await fetch(signed.url)).status).toBe(403);
  });
});
