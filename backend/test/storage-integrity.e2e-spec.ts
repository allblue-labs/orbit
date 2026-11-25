import { Test } from '@nestjs/testing';
import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { configureHttpParsers } from '../src/configure-http-parsers';
import { RequestContext, RequestContextStorage } from '../src/context';
import type { UUID } from '../src/contracts';
import { generateUuidV7 } from '../src/utils';
import { StorageFileRepository } from '../src/modules/storage/file-object.repository';
import { FileObjectService } from '../src/modules/storage/file-object.service';
import {
  STORAGE_CONFIG,
  type StorageConfig,
} from '../src/modules/storage/storage.config';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../src/modules/storage/storage.types';
import { createStorageProvider } from '../src/modules/storage/storage.module';
import { UploadBudgetService } from '../src/modules/storage/upload-budget.service';
import { uploadGrant } from '../src/modules/storage/upload-grant';
import { PrismaService } from '../src/database';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(45000);
const profiles = process.env.ORBIT_MINIO_TEST_ENDPOINT
  ? (['LOCAL', 'MINIO'] as const)
  : (['LOCAL'] as const);
const pdf = Buffer.from('%PDF-1.7\nSynthetic Orbit fixture\n%%EOF\n');

describe.each(profiles)('PR-09: immutable bounded upload on %s', (profile) => {
  const admin = adminPrisma();
  const apps: INestApplication<App>[] = [];
  let config: StorageConfig;
  let organizationId: string;
  let foreignOrganizationId: string;
  let userId: string;
  let provider: StorageProvider;
  let s3: S3Client | undefined;
  const contexts = (index = 0) => apps[index]!.get(RequestContextStorage);
  const scoped = <T>(work: () => T, index = 0, org = organizationId) =>
    contexts(index).run(
      new RequestContext({
        requestId: 'pr09',
        organizationId: org as UUID,
        userId: null,
        businessUnitId: null,
        businessUnitIds: [],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      work,
    );
  const files = (index = 0) => apps[index]!.get(FileObjectService);
  const reserve = (sizeBytes = pdf.length, mimeType = 'application/pdf') =>
    scoped(() =>
      files().reserve({
        organizationId,
        namespace: 'field-evidence',
        fileName: 'private-customer-name.pdf',
        mimeType,
        sizeBytes,
        createdById: null,
      }),
    );
  const path = (url: string) => {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  };
  const put = (url: string, body = pdf, index = 0) =>
    request(apps[index]!.getHttpServer())
      .put(path(url))
      .set('Content-Type', 'application/pdf')
      .send(body);

  beforeAll(async () => {
    const [db] = await admin.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_') ||
      db?.name !== process.env.ORBIT_E2E_DATABASE
    )
      throw new Error('Disposable runner required');
    const user = await admin.user.create({
      data: {
        id: generateUuidV7(),
        email: `pr09.${randomUUID()}@orbit.local`,
        normalizedEmail: `pr09.${randomUUID()}@orbit.local`,
        firstName: 'Upload',
        lastName: 'Test',
        displayName: 'Upload Test',
        status: 'ACTIVE',
      },
    });
    userId = user.id;
    const plan = await admin.plan.findFirstOrThrow({
      where: { key: 'ESSENTIAL' },
    });
    const org = () =>
      admin.organization.create({
        data: {
          id: generateUuidV7(),
          ownerUserId: user.id,
          planId: plan.id,
          slug: 'pr09-' + randomUUID(),
          displayName: 'Upload Test',
          primarySegment: 'HVAC_R',
          status: 'ACTIVE',
        },
      });
    organizationId = (await org()).id;
    foreignOrganizationId = (await org()).id;
    config = {
      provider: profile,
      bucket: 'pr09-' + randomUUID(),
      localRoot: process.env.ORBIT_E2E_DIRECTORY! + '/pr09-' + profile,
      localPublicBaseUrl: 'http://127.0.0.1/api/v1',
      localSigningSecret: randomUUID(),
      signedUrlTtlSeconds: 300,
    };
    if (profile === 'MINIO') {
      const endpoint = process.env.ORBIT_MINIO_TEST_ENDPOINT!;
      if (new URL(endpoint).hostname !== '127.0.0.1')
        throw new Error('Disposable loopback MinIO required');
      config = {
        ...config,
        s3: {
          endpoint,
          region: 'us-east-1',
          accessKeyId: process.env.ORBIT_MINIO_TEST_ACCESS_KEY!,
          secretAccessKey: process.env.ORBIT_MINIO_TEST_SECRET_KEY!,
          forcePathStyle: true,
        },
      };
      s3 = new S3Client({
        ...config.s3,
        credentials: {
          accessKeyId: config.s3!.accessKeyId,
          secretAccessKey: config.s3!.secretAccessKey,
        },
        requestChecksumCalculation: 'WHEN_REQUIRED',
      });
      await s3.send(new CreateBucketCommand({ Bucket: config.bucket }));
    }
    for (let n = 0; n < 2; n++) {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(STORAGE_CONFIG)
        .useValue(config)
        .overrideProvider(STORAGE_PROVIDER)
        .useValue(createStorageProvider(config))
        .compile();
      const app = module.createNestApplication<NestExpressApplication>({
        bodyParser: false,
        rawBody: true,
      });
      configureHttpParsers(app);
      configureApiVersioning(app);
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.listen(0, '127.0.0.1');
      apps.push(app);
    }
    provider = apps[0]!.get<StorageProvider>(STORAGE_PROVIDER);
  });
  afterEach(async () => {
    const rows = await admin.storageFile.findMany({
      where: { organizationId },
    });
    for (const row of rows)
      await provider.remove({ bucket: row.bucket, objectKey: row.objectKey });
    await admin.storageUploadAdmission.deleteMany({
      where: {
        organizationId: { in: [organizationId, foreignOrganizationId] },
      },
    });
    await admin.storageFile.deleteMany({ where: { organizationId } });
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    s3?.destroy();
    await admin.organization.deleteMany({
      where: { id: { in: [organizationId, foreignOrganizationId] } },
    });
    await admin.user.deleteMany({ where: { id: userId } });
    await disconnectAdminPrisma();
  });

  it('keeps confirmed bytes/hash stable through raw, multipart, replay and provider overwrite attempts', async () => {
    const ticket = await reserve();
    await request(apps[0]!.getHttpServer())
      .put(path(ticket.signed.url))
      .attach('file', pdf, {
        filename: 'private.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);
    const confirmed = await scoped(() =>
      files().confirm(ticket.file.id, organizationId),
    );
    expect(confirmed.objectKey).not.toBe(ticket.file.objectKey);
    const renewed = await scoped(() => files().sign(confirmed, 'upload'));
    expect(new URL(renewed.url).searchParams.get('key')).toBe(
      ticket.file.objectKey,
    );
    expect(renewed.requiredHeaders['content-type']).toBe('application/pdf');
    await put(renewed.url).expect(200);
    expect(FileObjectService.hash(await provider.get(confirmed))).toBe(
      confirmed.sha256,
    );
    await put(ticket.signed.url, pdf, 1).expect(200);
    await put(
      ticket.signed.url,
      Buffer.from('%PDF-1.7\nDIFFERENT\n%%EOF'),
    ).expect(400);
    await expect(
      provider.put({
        bucket: confirmed.bucket,
        objectKey: confirmed.objectKey,
        mimeType: confirmed.mimeType,
        body: Buffer.from('overwrite'),
      }),
    ).rejects.toThrow();
    const forgedCanonicalGrant = uploadGrant(config, {
      ...confirmed,
      operation: 'upload',
      expiresInSeconds: 300,
    });
    await put(forgedCanonicalGrant.url).expect(404);
    await expect(
      provider.sign({
        ...confirmed,
        operation: 'upload',
        expiresInSeconds: 300,
      }),
    ).rejects.toThrow();
    expect(await provider.get(confirmed)).toEqual(pdf);
    const download = await scoped(() => files().sign(confirmed, 'download'));
    if (profile === 'MINIO')
      expect(
        Buffer.from(await (await fetch(download.url)).arrayBuffer()),
      ).toEqual(pdf);
    else {
      const response = await request(apps[0]!.getHttpServer())
        .get(path(download.url))
        .buffer(true)
        .expect(200);
      expect(response.body as Buffer).toEqual(pdf);
    }
    expect(FileObjectService.hash(await provider.get(confirmed))).toBe(
      confirmed.sha256,
    );
    if (s3)
      expect(
        (await s3.send(new ListObjectsV2Command({ Bucket: config.bucket })))
          .Contents,
      ).toHaveLength(1);
  });
  it('uses one canonical object when two replicas finish the same pending reservation concurrently', async () => {
    const ticket = await reserve();
    let arrivals = 0;
    let proceed!: () => void;
    const barrier = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    for (const app of apps) {
      const storage = app.get<StorageProvider>(STORAGE_PROVIDER);
      const putOriginal = storage.put.bind(storage);
      jest.spyOn(storage, 'put').mockImplementation(async (input) => {
        if (++arrivals === 2) proceed();
        await barrier;
        return putOriginal(input);
      });
    }
    const changed = Buffer.from(pdf);
    changed[15] = 65;
    const results = await Promise.allSettled([
      scoped(
        () =>
          files(0).uploadReserved(
            organizationId,
            ticket.file.bucket,
            ticket.file.objectKey,
            pdf,
            'application/pdf',
          ),
        0,
      ),
      scoped(
        () =>
          files(1).uploadReserved(
            organizationId,
            ticket.file.bucket,
            ticket.file.objectKey,
            changed,
            'application/pdf',
          ),
        1,
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const confirmed = await scoped(() =>
      files().confirm(ticket.file.id, organizationId),
    );
    expect(FileObjectService.hash(await provider.get(confirmed))).toBe(
      confirmed.sha256,
    );
    if (s3)
      expect(
        (await s3.send(new ListObjectsV2Command({ Bucket: config.bucket })))
          .Contents,
      ).toHaveLength(1);
  });
  it('cleans an unreferenced canonical write if the database rejects completion', async () => {
    const ticket = await reserve();
    jest
      .spyOn(apps[0]!.get(StorageFileRepository), 'completeUpload')
      .mockResolvedValueOnce(null);
    await put(ticket.signed.url).expect(400);
    expect(
      (
        await admin.storageFile.findUniqueOrThrow({
          where: { id: ticket.file.id },
        })
      ).status,
    ).toBe('PENDING');
    if (s3)
      expect(
        (await s3.send(new ListObjectsV2Command({ Bucket: config.bucket })))
          .Contents ?? [],
      ).toHaveLength(0);
    await put(ticket.signed.url).expect(200);
  });
  it('preserves confirmed bytes when the COMMIT acknowledgment is lost, including an unavailable reconciliation read', async () => {
    const repository = apps[0]!.get(StorageFileRepository);
    const commit = repository.completeUpload.bind(repository);
    const ticket = await reserve();
    jest
      .spyOn(repository, 'completeUpload')
      .mockImplementationOnce(async (...args) => {
        await commit(...args);
        throw new Error('Synthetic lost COMMIT ACK');
      });
    await put(ticket.signed.url).expect(200);
    const first = await scoped(() =>
      files().confirm(ticket.file.id, organizationId),
    );
    expect(FileObjectService.hash(await provider.get(first))).toBe(
      first.sha256,
    );
    const second = await reserve();
    jest
      .spyOn(repository, 'completeUpload')
      .mockImplementationOnce(async (...args) => {
        await commit(...args);
        throw new Error('Synthetic lost COMMIT ACK');
      });
    jest
      .spyOn(repository, 'resolvePublication')
      .mockRejectedValueOnce(new Error('Synthetic unavailable DB read'));
    await put(second.signed.url).expect(500);
    const confirmed = await scoped(() =>
      files().confirm(second.file.id, organizationId),
    );
    expect(FileObjectService.hash(await provider.get(confirmed))).toBe(
      confirmed.sha256,
    );
    await put(second.signed.url).expect(200);
    expect(FileObjectService.hash(await provider.get(confirmed))).toBe(
      confirmed.sha256,
    );
    const create = repository.create.bind(repository);
    jest.spyOn(repository, 'create').mockImplementationOnce(async (data) => {
      await create(data);
      throw new Error('Synthetic lost create ACK');
    });
    const generated = await scoped(() =>
      files().store({
        organizationId,
        createdById: null,
        namespace: 'reports',
        fileName: 'private.pdf',
        mimeType: 'application/pdf',
        body: pdf,
      }),
    );
    expect(FileObjectService.hash(await provider.get(generated))).toBe(
      generated.sha256,
    );
  });

  it('keeps query capabilities and private names out of application logs', async () => {
    const logs = [
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
    ];
    const ticket = await reserve();
    await put(ticket.signed.url).expect(200);
    await put(ticket.signed.url, Buffer.from('bad')).expect(400);
    const output = JSON.stringify(logs.flatMap((logger) => logger.mock.calls));
    expect(output).not.toContain(
      new URL(ticket.signed.url).searchParams.get('signature'),
    );
    expect(output).not.toContain('private-customer-name');
    expect(output).not.toContain('signature=');
  });

  it('rejects invalid/deleted reservations, headers, MIME and disguised PDF before publication', async () => {
    const ticket = await reserve();
    await request(apps[0]!.getHttpServer())
      .put(path(ticket.signed.url))
      .set('Content-Type', 'image/png')
      .send(pdf)
      .expect(400);
    await put(ticket.signed.url, Buffer.alloc(pdf.length, 65)).expect(400);
    await put(ticket.signed.url, Buffer.alloc(pdf.length + 1)).expect(400);
    await admin.storageFile.update({
      where: { id: ticket.file.id },
      data: { deletedAt: new Date() },
    });
    await put(ticket.signed.url).expect(404);
    expect(await provider.head(ticket.file)).toBeNull();
  });
  it('bounds chunked input without Content-Length and accepts valid chunked bytes', async () => {
    const ticket = await reserve();
    const base = await apps[0]!.getUrl();
    const send = (chunks: Buffer[]) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          base + path(ticket.signed.url),
          {
            method: 'PUT',
            headers: {
              'content-type': 'application/pdf',
              'transfer-encoding': 'chunked',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode!));
          },
        );
        req.on('error', reject);
        for (const chunk of chunks) req.write(chunk);
        req.end();
      });
    expect(await send([Buffer.alloc(70000)])).toBe(413);
    expect(
      (
        await admin.storageFile.findUniqueOrThrow({
          where: { id: ticket.file.id },
        })
      ).status,
    ).toBe('PENDING');
    expect(await send([pdf.subarray(0, 10), pdf.subarray(10)])).toBe(200);
  });
  it('does not publish an interrupted multipart upload or retain its admission', async () => {
    const ticket = await reserve();
    const base = await apps[0]!.getUrl();
    await new Promise<void>((resolve) => {
      const req = httpRequest(base + path(ticket.signed.url), {
        method: 'PUT',
        headers: {
          'content-type': 'multipart/form-data; boundary=pr09',
          'transfer-encoding': 'chunked',
        },
      });
      req.on('error', () => resolve());
      req.write(
        '--pr09\r\nContent-Disposition: form-data; name="file"; filename="private.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-',
      );
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 100);
    });
    for (let n = 0; n < 30; n++) {
      if (
        (await admin.storageUploadAdmission.count({
          where: { organizationId },
        })) === 0
      )
        break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(
      await admin.storageUploadAdmission.count({ where: { organizationId } }),
    ).toBe(0);
    expect(
      (
        await admin.storageFile.findUniqueOrThrow({
          where: { id: ticket.file.id },
        })
      ).status,
    ).toBe('PENDING');
    expect(await provider.head(ticket.file)).toBeNull();
  });
  it('shares admission limits and file exclusion between replicas, expires leases and isolates tenants under RLS', async () => {
    const ticket = await reserve();
    const budget = (n: number) => apps[n]!.get(UploadBudgetService);
    const one = await scoped(() =>
      budget(0).acquire(organizationId, ticket.file.id),
    );
    await expect(
      scoped(() => budget(1).acquire(organizationId, ticket.file.id), 1),
    ).rejects.toMatchObject({ status: 429 });
    const two = await scoped(() => budget(1).acquire(organizationId), 1);
    await expect(
      scoped(() => budget(0).acquire(organizationId)),
    ).rejects.toMatchObject({ status: 429 });
    const foreign = await scoped(
      () => budget(0).acquire(foreignOrganizationId),
      0,
      foreignOrganizationId,
    );
    const prisma = apps[0]!.get(PrismaService);
    expect(await prisma.storageUploadAdmission.findMany()).toEqual([]);
    await admin.storageUploadAdmission.updateMany({
      where: { organizationId },
      data: { expiresAt: new Date(0) },
    });
    const recovered = await scoped(() =>
      budget(0).acquire(organizationId, ticket.file.id),
    );
    await scoped(one);
    await scoped(two, 1);
    await scoped(recovered);
    await scoped(foreign, 0, foreignOrganizationId);
    await expect(
      scoped(
        () => budget(0).acquire(foreignOrganizationId, ticket.file.id),
        0,
        foreignOrganizationId,
      ),
    ).rejects.toThrow();
  });
  it('serializes reservation count and byte budgets instead of allowing parallel accumulation', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 22 }, () => reserve()),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(20);
    expect(
      await admin.storageFile.count({
        where: { organizationId, status: 'PENDING' },
      }),
    ).toBe(20);
    await admin.storageFile.deleteMany({ where: { organizationId } });
    const large = await Promise.allSettled(
      Array.from({ length: 6 }, () => reserve(20_000_000)),
    );
    expect(large.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  });
});
