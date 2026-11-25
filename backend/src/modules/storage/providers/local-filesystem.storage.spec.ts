import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilesystemStorageProvider } from './local-filesystem.storage';

describe('LocalFilesystemStorageProvider', () => {
  let root: string;
  let provider: LocalFilesystemStorageProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'orbit-storage-'));
    provider = new LocalFilesystemStorageProvider(
      'orbit-artifacts',
      root,
      'http://localhost:6001/api/v1',
      'segredo-de-teste',
    );
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  const ref = { bucket: 'orbit-artifacts', objectKey: 'org/manifests/a.pdf' };

  it('grava, lê e remove preservando o conteúdo', async () => {
    const body = Buffer.from('conteúdo do documento');
    const stat = await provider.put({
      ...ref,
      body,
      mimeType: 'application/pdf',
    });

    expect(stat.sizeBytes).toBe(body.length);
    expect((await provider.get(ref)).toString()).toBe(body.toString());
    expect(await readFile(join(root, ref.bucket, ref.objectKey))).toEqual(body);

    await provider.remove(ref);
    expect(await provider.head(ref)).toBeNull();
  });

  it('publishes exactly one winner atomically and refuses subsequent overwrites', async () => {
    const writes = await Promise.allSettled(
      [Buffer.from('one'), Buffer.from('two')].map((body) =>
        provider.put({ ...ref, body, mimeType: 'application/pdf' }),
      ),
    );
    expect(writes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const original = await provider.get(ref);
    await expect(
      provider.put({
        ...ref,
        body: Buffer.from('changed'),
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow();
    expect(await provider.get(ref)).toEqual(original);
    expect(await readdir(join(root, ref.bucket, 'org/manifests'))).toEqual([
      'a.pdf',
    ]);
  });

  it('remover objeto inexistente não é erro', async () => {
    await expect(provider.remove(ref)).resolves.toBeUndefined();
  });

  it('recusa chave que escapa da raiz configurada', async () => {
    await expect(
      provider.get({
        bucket: 'orbit-artifacts',
        objectKey: '../../etc/passwd',
      }),
    ).rejects.toThrow();
  });

  describe('assinatura', () => {
    const sign = () =>
      provider.sign({
        ...ref,
        operation: 'download',
        expiresInSeconds: 300,
        fileName: 'documento.pdf',
      });

    const payloadOf = (url: string) => {
      const parsed = new URL(url);
      return {
        bucket: parsed.searchParams.get('bucket') as string,
        objectKey: parsed.searchParams.get('key') as string,
        operation: parsed.searchParams.get('operation') as 'download',
        expiresAt: Number(parsed.searchParams.get('expires')),
        signature: parsed.searchParams.get('signature') as string,
      };
    };

    it('emite URL verificável e sem revelar caminho do sistema', async () => {
      const signed = await sign();

      expect(provider.verify(payloadOf(signed.url))).toBe(true);
      expect(signed.url).not.toContain(root);
      expect(signed.method).toBe('GET');
    });

    it('recusa assinatura adulterada', async () => {
      const signed = await sign();
      const payload = payloadOf(signed.url);

      expect(provider.verify({ ...payload, signature: 'a'.repeat(64) })).toBe(
        false,
      );
      expect(
        provider.verify({ ...payload, objectKey: 'org/manifests/outro.pdf' }),
      ).toBe(false);
      expect(provider.verify({ ...payload, operation: 'upload' })).toBe(false);
    });

    it('recusa assinatura expirada', async () => {
      const signed = await provider.sign({
        ...ref,
        operation: 'download',
        expiresInSeconds: -1,
      });

      expect(provider.verify(payloadOf(signed.url))).toBe(false);
    });

    it('assinatura de outro segredo não vale', async () => {
      const outro = new LocalFilesystemStorageProvider(
        'orbit-artifacts',
        root,
        'http://localhost:6001/api/v1',
        'outro-segredo',
      );
      const signed = await sign();

      expect(outro.verify(payloadOf(signed.url))).toBe(false);
    });

    it('does not issue direct upload signatures outside a reservation', async () => {
      await expect(
        Promise.resolve().then(() =>
          provider.sign({ ...ref, operation: 'upload', expiresInSeconds: 300 }),
        ),
      ).rejects.toThrow();
    });
  });
});
