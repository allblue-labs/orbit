import sharp from 'sharp';
import { BrandImageService } from './brand-image.service';
import type { StorageCleanupService } from './storage-cleanup.service';
import { ImageOptimizationService } from './image-optimization.service';
import { FileObjectService } from './file-object.service';
import type { StorageFileRepository } from './file-object.repository';
import type { StorageConfig } from './storage.config';
import type { StorageFile } from '@prisma/client';
import type { CreateStorageFileData } from './file-object.repository';
import type {
  PutObjectInput,
  StorageObjectRef,
  StorageProvider,
} from './storage.types';
import { verifyUploadGrant } from './upload-grant';
import { pdfImage } from './pdf-image';

const organizationId = '01a15a3e-a137-759a-bcd7-7bbad774874f';
const config: StorageConfig = {
  provider: 'R2',
  bucket: 'private',
  privateBucket: 'private',
  publicBucket: 'public',
  publicUrl: 'https://cdn-orbit.allblue-labs.com',
  signedUrlTtlSeconds: 300,
  localRoot: '',
  localPublicBaseUrl: 'https://orbit.allblue-labs.com/api/v1',
  localSigningSecret: 'test-only-media-secret',
};
const png = (width = 200, height = 100) =>
  sharp({ create: { width, height, channels: 4, background: '#2563eb' } })
    .png()
    .toBuffer();

function setup() {
  const rows = new Map<string, StorageFile>();
  const objects = new Map<string, Buffer>();
  const provider = {
    name: 'R2',
    defaultBucket: 'private',
    put: jest.fn((input: PutObjectInput) => {
      objects.set(`${input.bucket}/${input.objectKey}`, input.body);
      return Promise.resolve();
    }),
    get: jest.fn((ref: StorageObjectRef) =>
      Promise.resolve(objects.get(`${ref.bucket}/${ref.objectKey}`)),
    ),
    remove: jest.fn((ref: StorageObjectRef) => {
      objects.delete(`${ref.bucket}/${ref.objectKey}`);
      return Promise.resolve();
    }),
    sign: jest.fn(() =>
      Promise.resolve({
        url: 'https://private.r2.cloudflarestorage.com/signed',
        expiresAt: new Date(),
        method: 'GET',
        requiredHeaders: {},
      }),
    ),
  };
  const repository = {
    markDeletedByRef: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn((data: CreateStorageFileData) => {
      const row = {
        ...data,
        businessUnitId: data.businessUnitId ?? null,
        metadata: data.metadata ?? {},
        deletedAt: null,
        id: `${rows.size}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(row.id, row as StorageFile);
      return Promise.resolve(row);
    }),
    find: jest.fn((id: string, organization: string) => {
      const row = rows.get(id);
      return Promise.resolve(row?.organizationId === organization ? row : null);
    }),
    findByRef: jest.fn((organization: string, bucket: string, key: string) =>
      Promise.resolve(
        [...rows.values()].find(
          (row) =>
            row.organizationId === organization &&
            ((row.bucket === bucket && row.objectKey === key) ||
              ((row.metadata as Record<string, unknown>).sourceObjectKey ===
                key &&
                (row.metadata as Record<string, unknown>).sourceBucket ===
                  bucket)),
        ),
      ),
    ),
    completeUpload: jest.fn(
      (
        id: string,
        organization: string,
        oldKey: string,
        data: Partial<StorageFile>,
      ) => {
        const row = rows.get(id);
        if (
          row?.organizationId !== organization ||
          row.objectKey !== oldKey ||
          row.status !== 'PENDING'
        )
          return Promise.resolve(null);
        const updated = { ...row, ...data, status: 'AVAILABLE' };
        rows.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
  };
  return {
    files: new FileObjectService(
      provider as unknown as StorageProvider,
      config,
      repository as unknown as StorageFileRepository,
    ),
    provider,
    repository,
    objects,
    rows,
  };
}

describe('R2 image pipeline', () => {
  it('optimizes and strips EXIF with proportional 1920/512 bounds, without enlarging', async () => {
    const images = new ImageOptimizationService();
    const original = await sharp(await png(2400, 1200))
      .withMetadata({ orientation: 1 })
      .jpeg()
      .toBuffer();
    const photo = await images.optimize(original, 'image/jpeg');
    const metadata = await sharp(photo).metadata();
    expect(metadata).toMatchObject({
      format: 'webp',
      width: 1920,
      height: 960,
    });
    expect(metadata.exif).toBeUndefined();
    expect(
      await sharp(
        await images.optimize(original, 'image/jpeg', true),
      ).metadata(),
    ).toMatchObject({ width: 512, height: 256 });
    expect(
      await sharp(
        await images.optimize(await png(40, 20), 'image/png'),
      ).metadata(),
    ).toMatchObject({ width: 40, height: 20 });
  });
  it('rejects disguised, corrupt, oversized and unsupported images', async () => {
    const images = new ImageOptimizationService();
    await expect(
      images.optimize(Buffer.from('<svg/>'), 'image/png'),
    ).rejects.toThrow();
    await expect(images.optimize(await png(), 'image/jpeg')).rejects.toThrow();
    await expect(
      images.optimize(Buffer.alloc(10_000_001), 'image/png'),
    ).rejects.toThrow();
    await expect(
      images.optimize(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        'image/png',
      ),
    ).rejects.toThrow();
  });
  it('binds upload grants to bucket/key/expiry and refuses reuse after upload', async () => {
    const { files, provider } = setup();
    const body = await png();
    const ticket = await files.reserve({
      organizationId,
      createdById: 'user',
      namespace: 'avatars',
      fileName: 'foto.png',
      mimeType: 'image/png',
      sizeBytes: body.length,
    });
    expect(ticket.file.bucket).toBe('private');
    const query = new URL(ticket.signed.url).searchParams;
    const grant = {
      bucket: query.get('bucket')!,
      key: query.get('key')!,
      expires: Number(query.get('expires')),
      signature: query.get('signature')!,
    };
    expect(verifyUploadGrant(config, grant)).toBe(true);
    expect(verifyUploadGrant(config, { ...grant, key: 'another' })).toBe(false);
    expect(verifyUploadGrant(config, { ...grant, expires: 1 })).toBe(false);
    await expect(
      files.uploadReserved(
        'another-tenant',
        grant.bucket,
        grant.key,
        body,
        'image/png',
      ),
    ).rejects.toThrow();
    const stored = await files.uploadReserved(
      organizationId,
      grant.bucket,
      grant.key,
      body,
      'image/png',
    );
    expect(stored).toMatchObject({
      bucket: 'public',
      mimeType: 'image/webp',
      metadata: {
        sourceSha256: FileObjectService.hash(body),
        sourceSizeBytes: body.length,
        sourceMimeType: 'image/png',
      },
    });
    expect(stored.objectKey).toMatch(
      new RegExp(`^avatars/${organizationId}/[0-9]+-[a-f0-9-]+\\.webp$`),
    );
    expect(provider.put).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    await expect(
      files.uploadReserved(
        organizationId,
        grant.bucket,
        grant.key,
        body,
        'image/png',
      ),
    ).resolves.toMatchObject({ id: stored.id });
    await expect(
      files.uploadReserved(
        organizationId,
        grant.bucket,
        grant.key,
        await png(100, 100),
        'image/png',
      ),
    ).rejects.toThrow();
    expect(provider.put).toHaveBeenCalledTimes(1);
    expect((await files.sign(stored, 'preview')).url).toBe(
      `${config.publicUrl}/${stored.objectKey}`,
    );
    expect((await files.confirm(stored.id, organizationId)).sha256).toBe(
      stored.sha256,
    );
  });
  it('keeps evidence and signatures private and produces embeddable PDF copies', async () => {
    const { files, provider, objects } = setup();
    const stored = await files.store({
      organizationId,
      createdById: 'user',
      namespace: 'signatures',
      body: await png(),
      fileName: 'assinatura.png',
      mimeType: 'image/png',
    });
    expect(stored.bucket).toBe('private');
    await files.sign(stored, 'preview');
    expect(provider.sign).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: 'private', operation: 'preview' }),
    );
    const body = objects.get(`${stored.bucket}/${stored.objectKey}`)!;
    expect(FileObjectService.hash(body)).toBe(stored.sha256);
    const printable = await pdfImage(body, stored.mimeType);
    expect(await sharp(printable.bytes).metadata()).toMatchObject({
      format: 'png',
    });
    expect(
      FileObjectService.hash(
        objects.get(`${stored.bucket}/${stored.objectKey}`)!,
      ),
    ).toBe(stored.sha256);
  });
  it('cleans the uploaded object if database persistence fails', async () => {
    const { files, repository, provider, objects } = setup();
    repository.create.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(
      files.store({
        organizationId,
        createdById: 'user',
        namespace: 'avatars',
        body: await png(),
        fileName: 'foto.png',
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('Database unavailable');
    expect(provider.remove).toHaveBeenCalledTimes(1);
    expect(objects.size).toBe(0);
  });
});

describe('brand references returned to clients', () => {
  it('resolves local internal references without changing CDN URLs or embedded legacy images', async () => {
    const { files, provider } = setup();
    const local = {
      ...config,
      provider: 'LOCAL' as const,
      publicUrl: undefined,
    };
    const brands = new BrandImageService(
      provider as unknown as StorageProvider,
      local,
      files,
      {} as StorageCleanupService,
    );
    const key = `logos/${organizationId}/1794532744234-01a1d27c-9c2a-7f85-934b-e100eb17ce93.webp`;
    await expect(brands.url(`r2-object:${key}`)).resolves.toBe(
      'https://private.r2.cloudflarestorage.com/signed',
    );
    expect(provider.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: key,
        operation: 'preview',
        expiresInSeconds: 300,
      }),
    );
    await expect(brands.url(`${config.publicUrl}/${key}`)).resolves.toBe(
      `${config.publicUrl}/${key}`,
    );
    await expect(brands.url('data:image/png;base64,legacy')).resolves.toBe(
      'data:image/png;base64,legacy',
    );
    await expect(brands.url('r2-object:../private')).resolves.toBeNull();
    await expect(brands.url(null)).resolves.toBeNull();
    expect(provider.sign).toHaveBeenCalledTimes(1);
  });
});
