import { UploadBudgetService } from '../src/modules/storage/upload-budget.service';
import { RequestContext, RequestContextStorage } from '../src/context';
import type { UUID } from '../src/contracts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import {
  PublicMediaCacheService,
  MediaCachePending,
} from '../src/modules/storage/public-media-cache.service';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database';
import { StorageCleanupService } from '../src/modules/storage/storage-cleanup.service';
import { SubscriptionDataRetentionService } from '../src/modules/billing/retention/subscription-data-retention.service';
import { mediaInventory } from '../src/modules/billing/retention/media-inventory';
import {
  STORAGE_CONFIG,
  type StorageConfig,
} from '../src/modules/storage/storage.config';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../src/modules/storage/storage.types';
import { createStorageProvider } from '../src/modules/storage/storage.module';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(90000);
const profiles = process.env.ORBIT_MINIO_TEST_ENDPOINT
  ? (['LOCAL', 'MINIO', 'S3', 'R2'] as const)
  : (['LOCAL'] as const);
const body = Buffer.from('%PDF-1.7\nSynthetic retention fixture\n%%EOF');
const hash = createHash('sha256').update(body).digest('hex');
const at = new Date();
const past = new Date(at.getTime() - 1000);
const day = 86400000;

describe.each(profiles)('PR-13: physical retention on %s', (profile) => {
  const admin = adminPrisma();
  const apps: INestApplication[] = [];
  const organizations: string[] = [];
  let storage: StorageProvider,
    config: StorageConfig,
    userId: string,
    s3: S3Client | undefined;
  const remote = {
    isEnabled: () => true,
    retrieveSubscription: jest.fn().mockResolvedValue({ state: 'ENDED' }),
    retrieveCheckoutSession: jest.fn(),
    expireCheckoutSession: jest.fn(),
  };
  const cleanup = (index = 0) => apps[index]!.get(StorageCleanupService);
  const retention = () =>
    new SubscriptionDataRetentionService(
      apps[0]!.get(PrismaService),
      remote as never,
      cleanup(),
    );
  async function fixture(deadline: Date = past) {
    const plan = await admin.plan.findFirstOrThrow({
      where: { isActive: true },
    });
    const org = await admin.organization.create({
      data: {
        ownerUserId: userId,
        planId: plan.id,
        slug: `pr13-${randomUUID()}`,
        displayName: 'Retention fixture',
        primarySegment: 'HVAC',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
      },
    });
    organizations.push(org.id);
    const unit = await admin.businessUnit.create({
      data: {
        organizationId: org.id,
        slug: 'matriz',
        type: 'HEADQUARTERS',
        isPrimary: true,
        legalName: 'Fixture',
        documentType: 'CNPJ',
        documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
        city: 'Recife',
        street: 'Rua',
        status: 'ACTIVE',
      },
    });
    const customer = await admin.customer.create({
      data: { organizationId: org.id, legalName: 'Synthetic customer' },
    });
    const subscription = await admin.organizationSubscription.create({
      data: {
        organizationId: org.id,
        planCode: 'ESSENCIAL',
        catalogVersion: 1,
        entitlementsSnapshot: {},
        billingInterval: 'MONTHLY',
        status: 'CANCELED',
        billingAnchorAt: new Date(at.getTime() - 60 * day),
        currentPeriodStart: new Date(at.getTime() - 60 * day),
        currentPeriodEnd: new Date(at.getTime() - 30 * day),
        dataRetentionEndsAt: deadline,
        providerSubscriptionId: `sub_${randomUUID()}`,
      },
    });
    const objectKey = `field-evidence/${org.id}/${randomUUID()}.pdf`;
    await storage.put({
      bucket: config.bucket,
      objectKey,
      body,
      mimeType: 'application/pdf',
    });
    const file = await admin.storageFile.create({
      data: {
        organizationId: org.id,
        provider: profile,
        bucket: config.bucket,
        objectKey,
        fileName: 'fixture.pdf',
        mimeType: 'application/pdf',
        sizeBytes: body.length,
        sha256: hash,
        status: 'AVAILABLE',
      },
    });
    return {
      org: org.id,
      unit: unit.id,
      customer: customer.id,
      subscription: subscription.id,
      file: file.id,
      objectKey,
    };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function legacy(f: Fixture, known = true) {
    const operation = await admin.operation.create({
      data: {
        organizationId: f.org,
        businessUnitId: f.unit,
        customerId: f.customer,
        code: randomUUID(),
        kind: 'SERVICE_ORDER',
        title: 'Retention fixture',
      },
    });
    const objectKey = `attachments/${f.org}/${randomUUID()}.pdf`;
    await storage.put({
      bucket: config.bucket,
      objectKey,
      body,
      mimeType: 'application/pdf',
    });
    const attachment = await admin.operationAttachment.create({
      data: {
        operationId: operation.id,
        uploadedById: userId,
        fileName: 'legacy.pdf',
        mimeType: 'application/pdf',
        size: body.length,
        storageKey: objectKey,
        checksum: hash,
        ...(known
          ? { storageProvider: profile, storageBucket: config.bucket }
          : {}),
      },
    });
    return { attachment, operation, objectKey };
  }
  async function allSources(f: Fixture) {
    await legacy(f);
    const source = `field-evidence/${f.org}/${randomUUID()}-source.pdf`;
    await storage.put({
      bucket: config.bucket,
      objectKey: source,
      body,
      mimeType: 'application/pdf',
    });
    await admin.storageFile.update({
      where: { id: f.file },
      data: {
        metadata: { sourceBucket: config.bucket, sourceObjectKey: source },
      },
    });
    const template = await admin.reportTemplate.create({
      data: {
        organizationId: f.org,
        key: randomUUID(),
        name: 'Fixture',
        reportKind: 'SERVICE_ORDER',
      },
    });
    const report = await admin.report.create({
      data: {
        organizationId: f.org,
        businessUnitId: f.unit,
        templateId: template.id,
        createdById: userId,
        code: randomUUID(),
        title: 'Fixture',
        templateVersion: 1,
        contentHash: hash,
      },
    });
    const doc = `documents/${f.org}/${randomUUID()}.pdf`;
    await storage.put({
      bucket: config.bucket,
      objectKey: doc,
      body,
      mimeType: 'application/pdf',
    });
    await admin.generatedDocument.create({
      data: {
        organizationId: f.org,
        reportId: report.id,
        version: 1,
        storageProvider: profile,
        storageBucket: config.bucket,
        storageKey: doc,
        mimeType: 'application/pdf',
        sizeBytes: body.length,
        sha256: hash,
        sourceHash: hash,
      },
    });
    const plan = await admin.pmocPlan.create({
      data: {
        organizationId: f.org,
        businessUnitId: f.unit,
        customerId: f.customer,
        code: randomUUID(),
        name: 'Fixture',
        startsOn: at,
        frequencyAmount: 1,
        frequencyUnit: 'MONTHS',
        createdById: userId,
      },
    });
    const contract = `pmoc-contract-documents/${f.org}/${randomUUID()}.pdf`;
    await storage.put({
      bucket: config.bucket,
      objectKey: contract,
      body,
      mimeType: 'application/pdf',
    });
    await admin.pmocPlanSignatureLink.create({
      data: {
        organizationId: f.org,
        planId: plan.id,
        tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        expiresAt: new Date(at.getTime() + day),
        createdById: userId,
        documentProvider: profile,
        documentBucket: config.bucket,
        documentObjectKey: contract,
        documentSha256: hash,
      },
    });
    const artifact = await admin.artifactTemplate.create({
      data: {
        organizationId: f.org,
        key: randomUUID(),
        name: 'Fixture',
        artifactType: 'SERVICE_ORDER',
      },
    });
    const version = await admin.artifactTemplateVersion.create({
      data: { organizationId: f.org, templateId: artifact.id, version: 1 },
    });
    const snapshot = await admin.artifactSnapshot.create({
      data: {
        organizationId: f.org,
        templateId: artifact.id,
        templateVersionId: version.id,
        templateVersion: 1,
        templateKey: artifact.key,
        templateName: 'Fixture',
        artifactType: 'SERVICE_ORDER',
        structureHash: hash,
      },
    });
    const execution = await admin.artifactExecution.create({
      data: {
        organizationId: f.org,
        businessUnitId: f.unit,
        templateId: artifact.id,
        snapshotId: snapshot.id,
        createdById: userId,
        code: randomUUID(),
        title: 'Fixture',
      },
    });
    const evidence = `legacy-evidence/${f.org}/${randomUUID()}.pdf`;
    await storage.put({
      bucket: config.bucket,
      objectKey: evidence,
      body,
      mimeType: 'application/pdf',
    });
    await admin.artifactExecutionAttachment.create({
      data: {
        organizationId: f.org,
        executionId: execution.id,
        uploadedById: userId,
        kind: 'EVIDENCE',
        fileName: 'Fixture.pdf',
        mimeType: 'application/pdf',
        sizeBytes: body.length,
        storageKey: evidence,
        checksum: hash,
        storageProvider: profile,
        storageBucket: config.bucket,
      },
    });
    // Modern storageKey is a file UUID: it must NOT be interpreted as another physical object.
    await admin.artifactExecutionAttachment.create({
      data: {
        organizationId: f.org,
        executionId: execution.id,
        uploadedById: userId,
        kind: 'EVIDENCE',
        fileName: 'Fixture.pdf',
        mimeType: 'application/pdf',
        sizeBytes: body.length,
        storageKey: f.file,
        fileId: f.file,
        checksum: hash,
      },
    });
    return [f.objectKey, source, doc, contract, evidence];
  }
  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable DB required');
    const email = `pr13.${randomUUID()}@orbit.local`;
    userId = (
      await admin.user.create({
        data: {
          email,
          normalizedEmail: email,
          firstName: 'Fixture',
          lastName: 'Retention',
          displayName: 'Fixture',
          status: 'ACTIVE',
        },
      })
    ).id;
    config = {
      provider: profile,
      bucket: `pr13-${profile.toLowerCase()}-${randomUUID()}`,
      localRoot: process.env.ORBIT_E2E_DIRECTORY! + `/pr13-${profile}`,
      localPublicBaseUrl: 'http://127.0.0.1/api/v1',
      localSigningSecret: randomUUID(),
      signedUrlTtlSeconds: 300,
    };
    if (profile !== 'LOCAL') {
      const endpoint = process.env.ORBIT_MINIO_TEST_ENDPOINT!;
      if (new URL(endpoint).hostname !== '127.0.0.1')
        throw new Error('Disposable MinIO required');
      config = {
        ...config,
        s3: {
          endpoint,
          region: 'us-east-1',
          accessKeyId: process.env.ORBIT_MINIO_TEST_ACCESS_KEY!,
          secretAccessKey: process.env.ORBIT_MINIO_TEST_SECRET_KEY!,
          forcePathStyle: true,
          legacyBucketAliases:
            profile === 'R2' ? { 'legacy-private': config.bucket } : {},
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
    for (let i = 0; i < 2; i++) {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(STORAGE_CONFIG)
        .useValue(config)
        .overrideProvider(STORAGE_PROVIDER)
        .useValue(createStorageProvider(config))
        .compile();
      const app = module.createNestApplication();
      await app.init();
      apps.push(app);
    }
    storage = apps[0]!.get(STORAGE_PROVIDER);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    remote.retrieveSubscription.mockResolvedValue({ state: 'ENDED' });
    // Isolate deliberately preserved expired fixtures from the next manual worker tick.
    await admin.organizationSubscription.updateMany({
      where: { organizationId: { in: organizations } },
      data: { dataRetentionEndsAt: null },
    });
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    s3?.destroy();
    await admin.storageDeletionJob.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await admin.tenantDataPurge.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await admin.organization.deleteMany({
      where: { id: { in: organizations } },
    });
    if (userId) await admin.user.deleteMany({ where: { id: userId } });
    await disconnectAdminPrisma();
  });
  it('preserves data until the explicit 30-day deadline and while the paid period remains valid', async () => {
    const f = await fixture(new Date(at.getTime() + 30 * day));
    await retention().run(at);
    expect(
      await storage.head({ bucket: config.bucket, objectKey: f.objectKey }),
    ).not.toBeNull();
    expect(await admin.customer.count({ where: { id: f.customer } })).toBe(1);
    await admin.organizationSubscription.update({
      where: { id: f.subscription },
      data: {
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(at.getTime() + day),
        dataRetentionEndsAt: past,
      },
    });
    await retention().run(at);
    expect(await admin.customer.count({ where: { id: f.customer } })).toBe(1);
    expect(
      await admin.storageDeletionJob.count({
        where: { organizationId: f.org },
      }),
    ).toBe(0);
  });
  it('atomically inventories all legacy/canonical sources and confirms physical absence without touching a neighbor', async () => {
    const f = await fixture(),
      foreign = await fixture(new Date(at.getTime() + day));
    const keys = await allSources(f);
    const inventory = await admin.$transaction((tx) =>
      mediaInventory(tx, f.org),
    );
    expect(new Set(inventory.map((file) => file.kind))).toEqual(
      new Set([
        'storage',
        'source',
        'operation',
        'document',
        'pmoc',
        'artifact',
      ]),
    );
    expect(inventory).toHaveLength(6);
    const guarded = retention() as unknown as {
      claim(org: string, sub: string, at: Date): Promise<boolean>;
      purge(org: string, sub: string, at: Date): Promise<void>;
    };
    expect(await guarded.claim(f.org, f.subscription, at)).toBe(true);
    await guarded.purge(f.org, f.subscription, at);
    await cleanup().drain();
    const purge = await admin.tenantDataPurge.findFirstOrThrow({
      where: { organizationId: f.org },
    });
    expect(purge).toMatchObject({ status: 'COMPLETE', objectCount: 6 });
    expect(purge.databasePurgedAt).not.toBeNull();
    expect(purge.completedAt).not.toBeNull();
    expect(await admin.customer.count({ where: { id: f.customer } })).toBe(0);
    expect(
      await admin.organizationSubscription.count({
        where: { id: f.subscription },
      }),
    ).toBe(1);
    for (const objectKey of keys)
      expect(
        await storage.head({ bucket: config.bucket, objectKey }),
      ).toBeNull();
    expect(
      await admin.storageDeletionJob.count({
        where: {
          organizationId: f.org,
          status: 'COMPLETE',
          originDeletedAt: { not: null },
        },
      }),
    ).toBe(6);
    expect(
      await storage.get({
        bucket: config.bucket,
        objectKey: foreign.objectKey,
      }),
    ).toEqual(body);
    await cleanup().drain(); // Replays keep the immutable completion audit.
    expect(
      await admin.storageDeletionJob.count({ where: { purgeId: purge.id } }),
    ).toBe(6);
  });
  it('blocks before deleting database rows when a legacy location is unknown', async () => {
    const f = await fixture();
    await legacy(f, false);
    await retention().run(at);
    expect(
      await admin.tenantDataPurge.findFirst({
        where: { organizationId: f.org },
      }),
    ).toMatchObject({
      status: 'BLOCKED',
      lastErrorCode: 'LEGACY_LOCATION_UNVERIFIED',
    });
    expect(await admin.customer.count({ where: { id: f.customer } })).toBe(1);
    expect(
      await admin.storageDeletionJob.count({
        where: { organizationId: f.org },
      }),
    ).toBe(0);
  });
  it('aborts a claimed purge when the subscription is reactivated before the database commit', async () => {
    const f = await fixture();
    const service = retention();
    // Exercise the real two-phase claim boundary; only this scheduling hook is test-controlled.
    const guarded = service as unknown as {
      claim(org: string, sub: string, at: Date): Promise<boolean>;
      purge(org: string, sub: string, at: Date): Promise<void>;
    };
    expect(await guarded.claim(f.org, f.subscription, at)).toBe(true);
    await admin.organizationSubscription.update({
      where: { id: f.subscription },
      data: {
        status: 'ACTIVE',
        currentPeriodEnd: new Date(at.getTime() + day),
      },
    });
    await guarded.purge(f.org, f.subscription, at);
    expect(
      await admin.tenantDataPurge.findFirst({
        where: { organizationId: f.org },
      }),
    ).toMatchObject({ status: 'ABORTED' });
    expect(await admin.customer.count({ where: { id: f.customer } })).toBe(1);
    expect(
      await storage.get({ bucket: config.bucket, objectKey: f.objectKey }),
    ).toEqual(body);
  });
  it('preserves data for a pending or dead-letter financial reconciliation', async () => {
    const f = await fixture();
    const sub = await admin.organizationSubscription.findUniqueOrThrow({
      where: { id: f.subscription },
    });
    const event = await admin.billingWebhookEvent.create({
      data: {
        provider: 'STRIPE',
        providerEventId: `evt_${randomUUID()}`,
        eventType: 'invoice.paid',
        providerSubscriptionId: sub.providerSubscriptionId,
        providerCreatedAt: at,
        processingStatus: 'DEAD_LETTER',
      },
    });
    await retention().run(at);
    expect(await admin.customer.count({ where: { id: f.customer } })).toBe(1);
    expect(
      await admin.tenantDataPurge.count({ where: { organizationId: f.org } }),
    ).toBe(0);
    await admin.billingWebhookEvent.delete({ where: { id: event.id } });
  });
  it('shares deletion claims across replicas and recovers a lost acknowledgement idempotently', async () => {
    const f = await fixture(new Date(at.getTime() + day));
    const job = await admin.storageDeletionJob.create({
      data: {
        organizationId: f.org,
        provider: profile,
        bucket: config.bucket,
        objectKey: f.objectKey,
      },
    });
    const first = jest.spyOn(storage, 'remove');
    const other = jest.spyOn(
      apps[1]!.get<StorageProvider>(STORAGE_PROVIDER),
      'remove',
    );
    await Promise.all([cleanup().drain(), cleanup(1).drain()]);
    expect(first.mock.calls.length + other.mock.calls.length).toBe(1);
    expect(
      await admin.storageDeletionJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({ status: 'COMPLETE', attempts: 1 });
    // Process died after DELETE and before ACK: object is already absent; lease expiry permits safe retry.
    await admin.storageDeletionJob.update({
      where: { id: job.id },
      data: {
        status: 'PROCESSING',
        completedAt: null,
        leaseToken: randomUUID(),
        leaseUntil: past,
      },
    });
    await cleanup().drain();
    expect(
      await admin.storageDeletionJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({ status: 'COMPLETE', attempts: 2 });
  });
  it('retains the only locator on failure and does not reinterpret a mismatched provider', async () => {
    const f = await fixture(new Date(at.getTime() + day));
    const job = await admin.storageDeletionJob.create({
      data: {
        organizationId: f.org,
        provider: profile,
        bucket: config.bucket,
        objectKey: f.objectKey,
      },
    });
    const failure = jest
      .spyOn(storage, 'remove')
      .mockRejectedValue(new Error('Synthetic outage'));
    await cleanup().drain();
    expect(
      await admin.storageDeletionJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'RETRY',
      lastErrorCode: 'STORAGE_DELETE_FAILED',
      attempts: 1,
    });
    failure.mockRestore();
    await admin.storageDeletionJob.update({
      where: { id: job.id },
      data: { provider: 'AZURE_BLOB', nextAttemptAt: past },
    });
    await cleanup().drain();
    expect(
      await admin.storageDeletionJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'BLOCKED',
      lastErrorCode: 'STORAGE_PROVIDER_MISMATCH',
    });
    expect(
      await storage.get({ bucket: config.bucket, objectKey: f.objectKey }),
    ).toEqual(body);
  });
  it('keeps physical completion pending until the public cache purge is confirmed', async () => {
    const f = await fixture(new Date(at.getTime() + day));
    const job = await admin.storageDeletionJob.create({
      data: {
        organizationId: f.org,
        provider: profile,
        bucket: config.bucket,
        objectKey: f.objectKey,
      },
    });
    const purge = jest
      .spyOn(apps[0]!.get(PublicMediaCacheService), 'purge')
      .mockRejectedValueOnce(
        new MediaCachePending('CACHE_PURGE_NOT_CONFIGURED'),
      );
    await cleanup().drain();
    expect(
      await storage.head({ bucket: config.bucket, objectKey: f.objectKey }),
    ).toBeNull();
    expect(
      await admin.storageDeletionJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'BLOCKED',
      lastErrorCode: 'CACHE_PURGE_NOT_CONFIGURED',
      completedAt: null,
      originDeletedAt: expect.any(Date) as unknown,
    });
    await admin.storageDeletionJob.update({
      where: { id: job.id },
      data: { nextAttemptAt: past },
    });
    purge.mockResolvedValueOnce();
    await cleanup().drain();
    expect(
      await admin.storageDeletionJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({ status: 'COMPLETE' });
  });
  it('cannot acknowledge or release a newer lease after a delayed delete response', async () => {
    const f = await fixture(new Date(at.getTime() + day)),
      newer = randomUUID();
    const job = await admin.storageDeletionJob.create({
      data: {
        organizationId: f.org,
        provider: profile,
        bucket: config.bucket,
        objectKey: f.objectKey,
      },
    });
    const remove = storage.remove.bind(storage);
    jest.spyOn(storage, 'remove').mockImplementationOnce(async (ref) => {
      await remove(ref);
      await admin.storageDeletionJob.update({
        where: { id: job.id },
        data: { leaseToken: newer, leaseUntil: new Date(Date.now() + 60000) },
      });
    });
    await cleanup().drain();
    expect(
      await admin.storageDeletionJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'PROCESSING',
      leaseToken: newer,
      completedAt: null,
    });
  });
  it('never deletes an object referenced by another tenant', async () => {
    const f = await fixture(new Date(at.getTime() + day)),
      neighbor = await fixture(new Date(at.getTime() + day));
    const job = await admin.storageDeletionJob.create({
      data: {
        organizationId: f.org,
        provider: profile,
        bucket: config.bucket,
        objectKey: neighbor.objectKey,
        ...(profile === 'R2' ? { bucket: 'legacy-private' } : {}),
      },
    });
    await cleanup().drain();
    expect(
      await admin.storageDeletionJob.findUnique({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'BLOCKED',
      lastErrorCode: 'OBJECT_OWNERSHIP_CONFLICT',
    });
    expect(
      await storage.get({
        bucket: config.bucket,
        objectKey: neighbor.objectKey,
        ...(profile === 'R2' ? { bucket: 'legacy-private' } : {}),
      }),
    ).toEqual(body);
  });
  it('releases the claim if the retention deadline is postponed before the commit', async () => {
    const f = await fixture();
    const guarded = retention() as unknown as {
      claim(org: string, sub: string, at: Date): Promise<boolean>;
      purge(org: string, sub: string, at: Date): Promise<void>;
    };
    expect(await guarded.claim(f.org, f.subscription, at)).toBe(true);
    await admin.organizationSubscription.update({
      where: { id: f.subscription },
      data: { dataRetentionEndsAt: new Date(at.getTime() + day) },
    });
    await guarded.purge(f.org, f.subscription, at);
    expect(
      await admin.organization.findUnique({ where: { id: f.org } }),
    ).toMatchObject({ dataPurgeStartedAt: null, dataPurgedAt: null });
    expect(
      await admin.tenantDataPurge.findFirst({
        where: { organizationId: f.org },
      }),
    ).toMatchObject({
      status: 'ABORTED',
      lastErrorCode: 'RETENTION_DEADLINE_CHANGED',
    });
  });
  if (profile === 'LOCAL')
    it('reconciles without deleting orphans and attests legacy locations only after byte/hash verification', async () => {
      const f = await fixture(new Date(at.getTime() + day));
      const old = await legacy(f, false);
      const orphan = `field-evidence/${f.org}/${randomUUID()}-orphan.pdf`;
      await storage.put({
        bucket: config.bucket,
        objectKey: orphan,
        body,
        mimeType: 'application/pdf',
      });
      const run = async (args: string[]) => {
        try {
          return {
            ...(await promisify(execFile)(
              process.execPath,
              [
                '-r',
                require.resolve('ts-node/register/transpile-only'),
                resolve('src/scripts/check-storage-retention.ts'),
                `--organization=${f.org}`,
                ...args,
              ],
              {
                env: {
                  ...process.env,
                  STORAGE_PROVIDER: 'LOCAL',
                  STORAGE_BUCKET: config.bucket,
                  STORAGE_LOCAL_DIR: config.localRoot,
                },
                timeout: 30000,
              },
            )),
            code: 0,
          };
        } catch (error) {
          const e = error as { stdout: string; stderr: string; code: number };
          return e;
        }
      };
      const read = await run([
        `--scan-prefix=field-evidence/${f.org}/`,
        `--scan-bucket=${config.bucket}`,
      ]);
      expect(read.code).toBe(2);
      expect(JSON.parse(read.stdout)).toMatchObject({
        mode: 'READ_ONLY',
        counts: { unknownLocation: 1, orphanCandidates: 1 },
      });
      expect(
        await admin.operationAttachment.findUnique({
          where: { id: old.attachment.id },
        }),
      ).toMatchObject({ storageProvider: null });
      const attest = await run([
        '--attest',
        '--legacy-provider=LOCAL',
        `--legacy-bucket=${config.bucket}`,
      ]);
      expect(attest.code).toBe(0);
      expect(JSON.parse(attest.stdout)).toMatchObject({
        counts: { attested: 1 },
      });
      expect(
        await admin.operationAttachment.findUnique({
          where: { id: old.attachment.id },
        }),
      ).toMatchObject({
        storageProvider: 'LOCAL',
        storageBucket: config.bucket,
      });
      expect(
        await storage.get({ bucket: config.bucket, objectKey: orphan }),
      ).toEqual(body);
      // Existing bytes with a different checksum must never certify a new location.
      await admin.operationAttachment.update({
        where: { id: old.attachment.id },
        data: {
          storageProvider: null,
          storageBucket: null,
          checksum: 'f'.repeat(64),
        },
      });
      const mismatch = await run([
        '--attest',
        '--legacy-provider=LOCAL',
        `--legacy-bucket=${config.bucket}`,
      ]);
      expect(mismatch.code).toBe(2);
      expect(
        await admin.operationAttachment.findUnique({
          where: { id: old.attachment.id },
        }),
      ).toMatchObject({ storageProvider: null });
    });
  it('waits for active uploads and refuses new admission after the purge claim', async () => {
    const f = await fixture();
    const admission = await admin.storageUploadAdmission.create({
      data: {
        id: randomUUID(),
        organizationId: f.org,
        storageFileId: f.file,
        expiresAt: new Date(Date.now() + 180000),
      },
    });
    await retention().run(at);
    expect(
      await admin.tenantDataPurge.count({ where: { organizationId: f.org } }),
    ).toBe(0);
    expect(
      await storage.get({ bucket: config.bucket, objectKey: f.objectKey }),
    ).toEqual(body);
    await admin.storageUploadAdmission.delete({ where: { id: admission.id } });
    const guarded = retention() as unknown as {
      claim(org: string, sub: string, at: Date): Promise<boolean>;
    };
    expect(await guarded.claim(f.org, f.subscription, at)).toBe(true);
    await expect(
      apps[0]!.get(RequestContextStorage).run(
        new RequestContext({
          requestId: 'pr13-upload',
          organizationId: f.org as UUID,
          userId: userId as UUID,
          businessUnitId: f.unit as UUID,
          businessUnitIds: [f.unit as UUID],
          roles: [],
          permissions: [],
          ip: null,
          userAgent: null,
          locale: 'pt-BR',
        }),
        () => apps[0]!.get(UploadBudgetService).acquire(f.org, f.file),
      ),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_UNAVAILABLE' });
  });
});
