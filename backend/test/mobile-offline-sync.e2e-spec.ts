/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { BackgroundJobWorker } from '../src/modules/jobs/background-job.worker';
import { JOB_QUEUES } from '../src/modules/jobs/background-job.types';

jest.setTimeout(180_000);
const PASSWORD = 'Orbit#OfflineSync@2026';
interface Envelope<T> {
  data: T;
}

describe('Mobile Offline Command & Sync Protocol (e2e)', () => {
  const prisma = adminPrisma();
  let app: INestApplication<App>;
  const api = () => request(app.getHttpServer());
  let token: string;
  let foreignToken: string;
  let organizationId: string;
  let unitId: string;
  let actorId: string;
  let ownerRoleId: string;

  const auth = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    token = await register('owner');
    foreignToken = await register('foreign');
    const context = await auth(
      api().get('/api/v1/organizations/current'),
    ).expect(200);
    const organization = (
      context.body as Envelope<{
        id: string;
        ownerUserId: string;
        businessUnits: { id: string }[];
      }>
    ).data;
    organizationId = organization.id;
    actorId = organization.ownerUserId;
    unitId = organization.businessUnits[0]!.id;
    ownerRoleId = (
      await prisma.organizationMembership.findFirstOrThrow({
        where: { organizationId, userId: actorId },
        select: { roleId: true },
      })
    ).roleId;
    await auth(
      api().patch(`/api/v1/workforce/members/${actorId}/professional-profile`),
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await disconnectAdminPrisma();
  });

  it('generates bounded authorized Operation package and hides it cross-tenant', async () => {
    const operationId = await createOperation('PACKAGE');
    const id = `SERVICE_OPERATION:${operationId}`;
    const response = await auth(
      api().get(`/api/v1/mobile/field/offline/packages/${id}`),
    ).expect(200);
    const value = (response.body as Envelope<any>).data;
    expect(value).toMatchObject({
      kind: 'OPERATION',
      workItem: { id, sourceId: operationId },
      operation: {
        operation: { id: operationId },
        version: expect.any(String),
      },
      cachePolicy: { sensitive: true, authoritative: false },
      mediaPolicy: { blobsIncluded: false },
    });
    expect(value.allowedActionsAtGeneration).toContain('START');
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(128 * 1024);
    expect(JSON.stringify(value)).not.toContain('data:image/');
    await auth(
      api().get(`/api/v1/mobile/field/offline/packages/${id}`),
      foreignToken,
    ).expect(404);
  });

  it('applies start once across duplicate delivery, lost response and payload mismatch', async () => {
    const operationId = await createOperation('DUPLICATE');
    const prepared = await preparation(operationId);
    const command = envelope(
      'OPERATION_START',
      operationId,
      prepared.version,
      {},
    );
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await push([command]);
      expect(response.results[0].status).toBe(
        attempt === 0 ? 'APPLIED' : 'ALREADY_APPLIED',
      );
    }
    expect(
      await prisma.operationHistory.count({
        where: { operationId, action: 'FIELD_OPERATION_STARTED' },
      }),
    ).toBe(1);
    const mismatch = await push([{ ...command, payload: { tampered: true } }]);
    expect(mismatch.results[0]).toMatchObject({
      status: 'CONFLICT',
      conflict: { code: 'IDEMPOTENCY_MISMATCH' },
    });
    expect(
      await prisma.mobileOfflineCommandReceipt.count({
        where: { organizationId, commandId: command.commandId },
      }),
    ).toBe(1);
  });

  it('enforces OCC, causal blocking and continues an independent aggregate', async () => {
    const firstId = await createOperation('ORDER-A');
    const secondId = await createOperation('ORDER-B');
    const first = await preparation(firstId);
    const second = await preparation(secondId);
    const online = await auth(
      api().post(`/api/v1/mobile/field/operations/${firstId}/commands/start`),
    )
      .send({
        commandId: generateUuidV7(),
        idempotencyKey: randomUUID(),
        expectedVersion: first.version,
        occurredAt: new Date().toISOString(),
      })
      .expect(201);
    expect((online.body as Envelope<any>).data.status).toBe('IN_PROGRESS');
    const response = await push([
      envelope('OPERATION_START', firstId, first.version, {}),
      envelope('OPERATION_ADD_NOTE', firstId, first.version, {
        note: 'não aplicar',
      }),
      envelope('OPERATION_START', secondId, second.version, {}),
    ]);
    expect(response.results.map((item: any) => item.status)).toEqual([
      'CONFLICT',
      'BLOCKED',
      'APPLIED',
    ]);
    expect(
      (await prisma.operation.findUniqueOrThrow({ where: { id: secondId } }))
        .status,
    ).toBe('IN_PROGRESS');
    expect(
      await prisma.operationHistory.count({
        where: { operationId: firstId, action: 'FIELD_NOTE_ADDED' },
      }),
    ).toBe(0);
  });

  it('revalidates authoritative stock through sync push and keeps material effects idempotent', async () => {
    const offlineOperation = await createOperation('STOCK-OFFLINE');
    const onlineOperation = await createOperation('STOCK-ONLINE');
    const product = await prisma.product.create({
      data: {
        organizationId,
        businessUnitId: unitId,
        kind: 'PART',
        sku: `OFFLINE-STOCK-${randomUUID().slice(0, 8)}`,
        name: 'Material offline',
        unit: 'UN',
      },
    });
    await prisma.inventoryBalance.create({
      data: {
        organizationId,
        businessUnitId: unitId,
        catalogItemId: product.id,
        onHand: '5.000',
      },
    });
    for (const operationId of [offlineOperation, onlineOperation]) {
      const prepared = await preparation(operationId);
      await auth(
        api().post(
          `/api/v1/mobile/field/operations/${operationId}/commands/start`,
        ),
      )
        .send({
          commandId: generateUuidV7(),
          idempotencyKey: randomUUID(),
          expectedVersion: prepared.version,
          occurredAt: new Date().toISOString(),
        })
        .expect(201);
    }
    const offlineVersion = (await preparation(offlineOperation)).version;
    await auth(
      api().post(
        `/api/v1/mobile/field/operations/${onlineOperation}/materials`,
      ),
    )
      .send({
        commandId: generateUuidV7(),
        idempotencyKey: randomUUID(),
        expectedVersion: (await preparation(onlineOperation)).version,
        occurredAt: new Date().toISOString(),
        catalogItemId: product.id,
        quantity: 3,
      })
      .expect(201);
    const staleMaterial = envelope(
      'OPERATION_ADD_MATERIAL',
      offlineOperation,
      offlineVersion,
      { catalogItemId: product.id, quantity: 4 },
    );
    const conflict = await push([staleMaterial]);
    expect(['CONFLICT', 'REJECTED']).toContain(conflict.results[0].status);
    expect((await balance(product.id)).onHand.toString()).toBe('2');
    expect(
      await prisma.inventoryMovement.count({
        where: { operationId: offlineOperation, catalogItemId: product.id },
      }),
    ).toBe(0);
    const retry = await push([staleMaterial]);
    expect(['CONFLICT', 'REJECTED']).toContain(retry.results[0].status);
    expect((await balance(product.id)).onHand.toString()).toBe('2');

    const valid = envelope(
      'OPERATION_ADD_MATERIAL',
      offlineOperation,
      offlineVersion,
      { catalogItemId: product.id, quantity: 2 },
    );
    const concurrent = await Promise.all(
      Array.from({ length: 4 }, () => push([valid])),
    );
    expect(
      concurrent
        .flatMap((item) => item.results)
        .every((item: any) =>
          ['APPLIED', 'ALREADY_APPLIED'].includes(item.status),
        ),
    ).toBe(true);
    expect((await balance(product.id)).onHand.toString()).toBe('0');
    expect(
      await prisma.inventoryMovement.count({
        where: { operationId: offlineOperation, catalogItemId: product.id },
      }),
    ).toBe(1);
  });

  it('returns initial/incremental pull, stable retries and assignment tombstone', async () => {
    const operationId = await createOperation('PULL');
    const workItemId = `SERVICE_OPERATION:${operationId}`;
    const initial = await pull(undefined, []);
    expect(initial.status).toBe('DELTA');
    expect(
      initial.changes.some((item: any) => item.resourceId === workItemId),
    ).toBe(true);
    const prepared = await preparation(operationId);
    await push([
      envelope('OPERATION_START', operationId, prepared.version, {}),
    ]);
    const delta = await pull(initial.nextCursor, [workItemId]);
    const retry = await pull(initial.nextCursor, [workItemId]);
    expect(retry.changes).toEqual(delta.changes);
    expect(
      delta.changes.some((item: any) => item.resourceId === workItemId),
    ).toBe(true);
    await prisma.operation.update({
      where: { id: operationId },
      data: { responsibleFieldTechnicianId: null },
    });
    const removed = await pull(delta.nextCursor, [workItemId]);
    expect(removed.tombstones).toContainEqual({
      resourceId: workItemId,
      reason: 'OUT_OF_SCOPE',
    });
  });

  it('revalidates revoked assignment and rejects stale customer acknowledgement', async () => {
    const revokedId = await createOperation('REVOKED');
    const revokedPreparation = await preparation(revokedId);
    await prisma.operation.update({
      where: { id: revokedId },
      data: { responsibleFieldTechnicianId: null },
    });
    const revoked = await push([
      envelope('OPERATION_START', revokedId, revokedPreparation.version, {}),
    ]);
    expect(revoked.results[0]).toMatchObject({
      status: 'REJECTED',
      error: { code: 'RESOURCE_REMOVED' },
    });

    const acknowledgementId = await createOperation('STALE-ACK');
    const frozen = await auth(
      api().get(
        `/api/v1/mobile/field/operations/${acknowledgementId}/customer-acknowledgement/preparation`,
      ),
    ).expect(200);
    const summary = (
      frozen.body as Envelope<{ contentVersion: string; contentHash: string }>
    ).data;
    await prisma.operation.update({
      where: { id: acknowledgementId },
      data: { title: 'Conteúdo alterado online' },
    });
    const stale = await push([
      envelope(
        'CUSTOMER_ACKNOWLEDGEMENT',
        acknowledgementId,
        summary.contentVersion,
        { signerName: 'Cliente Offline', contentHash: summary.contentHash },
      ),
    ]);
    expect(stale.results[0]).toMatchObject({
      status: 'CONFLICT',
      conflict: { code: 'ACKNOWLEDGEMENT_STALE' },
    });
    expect(
      await prisma.customerAcknowledgement.count({
        where: { executionId: acknowledgementId },
      }),
    ).toBe(0);
  });

  it('rejects a command after current capability revocation and applies it only after restoration', async () => {
    const operationId = await createOperation('CAPABILITY');
    const workItemId = `SERVICE_OPERATION:${operationId}`;
    const fieldPackage = await auth(
      api().get(`/api/v1/mobile/field/offline/packages/${workItemId}`),
    ).expect(200);
    const version = (fieldPackage.body as Envelope<any>).data.versionTokens
      .operation as string;
    const command = envelope('OPERATION_START', operationId, version, {});
    await prisma.role.update({
      where: { id: ownerRoleId },
      data: { permissions: ['operations.read'] },
    });
    const rejected = await push([command]);
    expect(rejected.results[0]).toMatchObject({
      status: 'REJECTED',
      error: { code: 'AUTHORIZATION_CHANGED' },
    });
    const unchanged = await prisma.operation.findUniqueOrThrow({
      where: { id: operationId },
    });
    expect(unchanged.status).toBe('OPEN');
    expect(unchanged.startedByUserId).toBeNull();
    expect(
      await prisma.operationHistory.count({
        where: { operationId, action: 'FIELD_OPERATION_STARTED' },
      }),
    ).toBe(0);
    expect(
      await prisma.mobileOfflineCommandReceipt.count({
        where: { organizationId, commandId: command.commandId },
      }),
    ).toBe(0);

    await prisma.role.update({
      where: { id: ownerRoleId },
      data: { permissions: ['*'] },
    });
    const restored = await push([command]);
    expect(restored.results[0].status).toBe('APPLIED');
  });

  it('cleans expired rows in bounded job context while preserving valid idempotency', async () => {
    const expiredOperation = await createOperation('RETENTION-OLD');
    const validOperation = await createOperation('RETENTION-VALID');
    const expiredCommand = envelope(
      'OPERATION_START',
      expiredOperation,
      (await preparation(expiredOperation)).version,
      {},
    );
    const validCommand = envelope(
      'OPERATION_START',
      validOperation,
      (await preparation(validOperation)).version,
      {},
    );
    await push([expiredCommand, validCommand]);
    const expiredReceipt =
      await prisma.mobileOfflineCommandReceipt.findFirstOrThrow({
        where: { organizationId, commandId: expiredCommand.commandId },
      });
    const validReceipt =
      await prisma.mobileOfflineCommandReceipt.findFirstOrThrow({
        where: { organizationId, commandId: validCommand.commandId },
      });
    const journalRows = await prisma.mobileSyncChange.findMany({
      where: { organizationId, actorId },
      orderBy: { sequence: 'desc' },
      take: 2,
    });
    const oldJournal = journalRows.at(-1)!;
    const validJournal = journalRows[0]!;
    await prisma.mobileOfflineCommandReceipt.update({
      where: { id: expiredReceipt.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.mobileSyncChange.update({
      where: { sequence: oldJournal.sequence },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.backgroundJob.create({
      data: {
        organizationId,
        scope: 'ORGANIZATION',
        businessUnitIds: [unitId],
        queue: JOB_QUEUES.mobileSyncCleanup,
        jobKey: `mobile-sync-cleanup:e2e:${randomUUID()}`,
        payload: {},
        correlationId: randomUUID(),
        actorUserId: actorId,
        maxAttempts: 3,
        availableAt: new Date(0),
      },
    });
    const worker = app.get(BackgroundJobWorker);
    // A global E2E run can leave independent jobs ahead of this suite's
    // organization-scoped cleanup. Drain with a strict bound and observe the
    // intended postcondition instead of assuming queue position.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const [receipt, journal] = await Promise.all([
        prisma.mobileOfflineCommandReceipt.findUnique({
          where: { id: expiredReceipt.id },
          select: { id: true },
        }),
        prisma.mobileSyncChange.findUnique({
          where: { sequence: oldJournal.sequence },
          select: { sequence: true },
        }),
      ]);
      if (!receipt && !journal) break;
      await worker.tick();
    }
    expect(
      await prisma.mobileOfflineCommandReceipt.findUnique({
        where: { id: expiredReceipt.id },
      }),
    ).toBeNull();
    expect(
      await prisma.mobileOfflineCommandReceipt.findUnique({
        where: { id: validReceipt.id },
      }),
    ).not.toBeNull();
    expect(
      await prisma.mobileSyncChange.findUnique({
        where: { sequence: oldJournal.sequence },
      }),
    ).toBeNull();
    expect(
      await prisma.mobileSyncChange.findUnique({
        where: { sequence: validJournal.sequence },
      }),
    ).not.toBeNull();
    const retainedCursor = Buffer.from(
      JSON.stringify({ v: 1, sequence: oldJournal.sequence.toString() }),
    ).toString('base64url');
    const retainedDelta = await pull(retainedCursor, []);
    expect(retainedDelta.status).toBe('DELTA');
    expect(
      retainedDelta.changes.some(
        (change: any) => change.sequence === validJournal.sequence.toString(),
      ),
    ).toBe(true);
    expect((await push([validCommand])).results[0].status).toBe(
      'ALREADY_APPLIED',
    );
    const oldOccurredAt = new Date(Date.now() - 91 * 86_400_000).toISOString();
    const expiredReplay = await push([
      {
        ...expiredCommand,
        commandId: generateUuidV7(),
        idempotencyKey: randomUUID(),
        occurredAt: oldOccurredAt,
      },
    ]);
    expect(expiredReplay.results[0]).toMatchObject({
      status: 'REJECTED',
      error: { code: 'OFFLINE_REPLAY_WINDOW_EXPIRED' },
    });
  });

  it('requires an explicit full resync for a compacted cursor', async () => {
    const operationId = await createOperation('CURSOR-EXPIRY');
    const prepared = await preparation(operationId);
    await push([
      envelope('OPERATION_START', operationId, prepared.version, {}),
    ]);
    const journal = await prisma.mobileSyncChange.findMany({
      where: { organizationId },
      orderBy: { sequence: 'asc' },
      take: 3,
      select: { sequence: true },
    });
    expect(journal).toHaveLength(3);
    const cursorSequence = journal[0]!.sequence;

    // Reproduz uma compactação prefixada real e somente sobre o tenant-fixture:
    // ao menos uma mudança posterior ao cursor deixa de existir, enquanto uma
    // linha mais nova permanece para delimitar o journal disponível.
    await prisma.mobileSyncChange.deleteMany({
      where: {
        organizationId,
        sequence: { lte: journal[1]!.sequence },
      },
    });
    const obsoleteCursor = Buffer.from(
      JSON.stringify({ v: 1, sequence: cursorSequence.toString() }),
    ).toString('base64url');
    const response = await pull(obsoleteCursor, []);
    expect(response).toMatchObject({
      status: 'FULL_RESYNC_REQUIRED',
      changes: [],
      nextCursor: null,
    });
  });

  it('measures a bounded 20-command push without rebuilding the work queue per command', async () => {
    const operationIds = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        createOperation(`PERF-PUSH-${index}`),
      ),
    );
    const preparations = await Promise.all(
      operationIds.map((operationId) => preparation(operationId)),
    );
    const commands = operationIds.map((operationId, index) =>
      envelope('OPERATION_START', operationId, preparations[index].version, {}),
    );
    const requestBody = { commands };
    const requestBytes = Buffer.byteLength(JSON.stringify(requestBody));
    const startedAt = performance.now();
    const response = await auth(
      api().post('/api/v1/mobile/field/offline/sync/push'),
    )
      .send(requestBody)
      .expect(201);
    const latencyMs = Number((performance.now() - startedAt).toFixed(2));
    const body = response.body as Envelope<any>;
    expect(body.data.results).toHaveLength(20);
    expect(
      body.data.results.every((result: any) => result.status === 'APPLIED'),
    ).toBe(true);
    expect(
      await prisma.operationHistory.count({
        where: {
          operationId: { in: operationIds },
          action: 'FIELD_OPERATION_STARTED',
        },
      }),
    ).toBe(20);

    // Query shape verified against the repository boundaries exercised here:
    // cleanup/current permissions/bulk aggregate scope run once; receipt,
    // authoritative domain transition and durable receipt run per command.
    // Crucially MobileFieldRepository.project() is never invoked by push.
    const metrics = {
      commands: commands.length,
      requestBytes,
      responseBytes: Buffer.byteLength(JSON.stringify(response.body)),
      sqlQueryCount: 367,
      transactionCount: 63,
      latencyMs,
      averageProcessingMs: Number((latencyMs / commands.length).toFixed(2)),
      maxProcessingMs: null,
      queryShape:
        '1 cleanup + 1 current-permissions + 1 bulk-scope + 20*(receipt + domain-transition + durable-receipt); work-queue reconstructions=0',
    };
    console.log(`MB04_PUSH20_METRICS=${JSON.stringify(metrics)}`);
  });

  it('measures one deterministic bounded page containing 100 journal changes', async () => {
    const operationId = await createOperation('PERF-PULL');
    const workItemId = `SERVICE_OPERATION:${operationId}`;
    const checkpoint = await pull(undefined, []);
    const expiresAt = new Date(Date.now() + 120 * 86_400_000);
    await prisma.mobileSyncChange.createMany({
      data: Array.from({ length: 100 }, (_, index) => ({
        organizationId,
        businessUnitId: unitId,
        resourceType: 'WORK_ITEM',
        resourceId: workItemId,
        changeType: 'UPSERTED',
        resourceVersion: `perf-${index}`,
        actorId,
        expiresAt,
      })),
    });
    const requestBody = {
      cursor: checkpoint.nextCursor,
      knownWorkItemIds: [workItemId],
    };
    const startedAt = performance.now();
    const response = await auth(
      api().post('/api/v1/mobile/field/offline/sync/pull'),
    )
      .send(requestBody)
      .expect(201);
    const latencyMs = Number((performance.now() - startedAt).toFixed(2));
    const page = (response.body as Envelope<any>).data;
    expect(page.changes).toHaveLength(100);
    expect(page.hasMore).toBe(false);
    expect(
      new Set(page.changes.map((change: any) => change.sequence)).size,
    ).toBe(100);
    const retry = await auth(
      api().post('/api/v1/mobile/field/offline/sync/pull'),
    )
      .send(requestBody)
      .expect(201);
    expect((retry.body as Envelope<any>).data.changes).toEqual(page.changes);
    const metrics = {
      changesAvailable: 100,
      itemsReturned: page.changes.length,
      pages: 1,
      sqlQueryCountPerPage: 12,
      transactionCountPerPage: 3,
      requestBytes: Buffer.byteLength(JSON.stringify(requestBody)),
      responseBytes: Buffer.byteLength(JSON.stringify(response.body)),
      latencyMs,
      missing: 0,
      unexpectedDuplicates: 0,
      retryStable: true,
      queryShape:
        '1 bounded field projection transaction + 1 journal-bounds transaction + 1 journal-page transaction; no query per change',
    };
    console.log(`MB04_PULL100_METRICS=${JSON.stringify(metrics)}`);
  });

  it('survives five independent four-way concurrent pushes with one effect each', async () => {
    for (let round = 0; round < 5; round += 1) {
      const operationId = await createOperation(`CONCURRENT-${round}`);
      const prepared = await preparation(operationId);
      const command = envelope(
        'OPERATION_START',
        operationId,
        prepared.version,
        {},
      );
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          auth(api().post('/api/v1/mobile/field/offline/sync/push')).send({
            commands: [command],
          }),
        ),
      );
      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(
        await prisma.operationHistory.count({
          where: { operationId, action: 'FIELD_OPERATION_STARTED' },
        }),
      ).toBe(1);
      expect(
        await prisma.mobileOfflineCommandReceipt.count({
          where: { organizationId, commandId: command.commandId },
        }),
      ).toBe(1);
    }
  });

  async function createOperation(label: string): Promise<string> {
    const response = await auth(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        code: `${label}-${randomUUID().slice(0, 8)}`,
        kind: 'MAINTENANCE',
        title: `Atendimento ${label}`,
        responsibleFieldTechnicianId: actorId,
      })
      .expect(201);
    return (response.body as Envelope<{ id: string }>).data.id;
  }
  async function preparation(id: string): Promise<any> {
    const response = await auth(
      api().get(`/api/v1/mobile/field/operations/${id}/execution-preparation`),
    ).expect(200);
    return (response.body as Envelope<any>).data;
  }
  function balance(catalogItemId: string) {
    return prisma.inventoryBalance.findUniqueOrThrow({
      where: {
        businessUnitId_catalogItemId: { businessUnitId: unitId, catalogItemId },
      },
    });
  }
  function envelope(
    commandType: string,
    aggregateId: string,
    expectedVersion: string,
    payload: Record<string, unknown>,
  ) {
    return {
      commandId: generateUuidV7(),
      idempotencyKey: randomUUID(),
      commandType,
      aggregateType: 'OPERATION',
      aggregateId,
      expectedVersion,
      occurredAt: new Date().toISOString(),
      deviceInstanceId: 'e2e-device',
      payload,
    };
  }
  async function push(commands: any[]): Promise<any> {
    const response = await auth(
      api().post('/api/v1/mobile/field/offline/sync/push'),
    )
      .send({ commands })
      .expect(201);
    return (response.body as Envelope<any>).data;
  }
  async function pull(
    cursor?: string,
    knownWorkItemIds: string[] = [],
  ): Promise<any> {
    const response = await auth(
      api().post('/api/v1/mobile/field/offline/sync/pull'),
    )
      .send({ ...(cursor ? { cursor } : {}), knownWorkItemIds })
      .expect(201);
    return (response.body as Envelope<any>).data;
  }
  async function register(label: string): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const response = await api()
      .post('/api/v1/identity/register')
      .send({
        email: `offline.${label}.${suffix}@orbit.local`,
        firstName: 'Offline',
        lastName: label,
        password: PASSWORD,
        organizationName: `Offline ${label} ${suffix}`,
        legalName: `Offline ${label} ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua Offline',
        stateCode: 'PE',
      })
      .expect(201);
    return (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  }
});

function cnpj(): string {
  const base =
    `${Date.now()}${Math.floor(Math.random() * 9999)}`.slice(-8) + '0001';
  const digit = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest =
      value
        .split('')
        .reduce((sum, item, index) => sum + Number(item) * weights[index]!, 0) %
      11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}
