/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import {
  CUSTOMER_PORTAL_TOKEN_DELIVERY,
  type CustomerPortalTokenDelivery,
  type CustomerPortalTokenPurpose,
} from '../src/modules/customer-portal/customer-portal.types';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../src/modules/storage/storage.types';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);

const PASSWORD = 'Orbit#PortalRead@2026';
const FINAL_STATUSES = ['APPROVED', 'COMPLETED', 'ARCHIVED'];

interface Envelope<T> {
  data: T;
}

class PortalDelivery implements CustomerPortalTokenDelivery {
  readonly entries: Array<{
    purpose: CustomerPortalTokenPurpose;
    recipient: string;
    token: string;
  }> = [];

  deliver(
    purpose: CustomerPortalTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<void> {
    this.entries.push({ purpose, recipient, token });
    return Promise.resolve();
  }

  invitation(recipient: string): string {
    const entry = [...this.entries]
      .reverse()
      .find(
        (item) => item.purpose === 'INVITATION' && item.recipient === recipient,
      );
    if (!entry) throw new Error(`No invitation for ${recipient}`);
    return entry.token;
  }
}

describe('Customer Portal operational Read Models (e2e)', () => {
  const prisma = adminPrisma();
  const delivery = new PortalDelivery();
  let app: INestApplication<App>;
  let storage: StorageProvider;
  let internalTokenA: string;
  let internalTokenC: string;
  let portalTokenA: string;
  let portalTokenB: string;
  let organizationIdA: string;
  let organizationIdC: string;
  let unitIdA: string;
  let unitIdC: string;
  let ownerIdA: string;
  let ownerIdC: string;
  let customerIdA: string;
  let customerIdB: string;
  let customerIdC: string;
  let operationIdA: string;
  let operationIdB: string;
  let operationIdC: string;
  let deletedOperationIdA: string;
  let assetIdA: string;
  let assetIdB: string;
  let assetIdC: string;
  let pmocIdA: string;
  let pmocIdB: string;
  let rvtIdA: string;
  let rvtIdB: string;
  let documentIdA: string;
  let documentIdB: string;
  let documentIdC: string;

  const api = () => request(app.getHttpServer());
  const internal = (test: request.Test, token = internalTokenA) =>
    test.set('Authorization', `Bearer ${token}`);
  const portal = (test: request.Test, token = portalTokenA) =>
    test.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CUSTOMER_PORTAL_TOKEN_DELIVERY)
      .useValue(delivery)
      .compile();
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
    storage = app.get<StorageProvider>(STORAGE_PROVIDER);

    const tenantA = await createTenant('a');
    internalTokenA = tenantA.token;
    organizationIdA = tenantA.organizationId;
    unitIdA = tenantA.unitId;
    ownerIdA = tenantA.ownerId;

    const tenantC = await createTenant('c');
    internalTokenC = tenantC.token;
    organizationIdC = tenantC.organizationId;
    unitIdC = tenantC.unitId;
    ownerIdC = tenantC.ownerId;

    customerIdA = await createCustomer(internalTokenA, 'Customer Portal A');
    customerIdB = await createCustomer(internalTokenA, 'Customer Portal B');
    customerIdC = await createCustomer(internalTokenC, 'Customer Portal C');

    portalTokenA = await inviteAndActivate(
      internalTokenA,
      customerIdA,
      `portal.e2e.read.a.${randomUUID()}@orbit.local`,
    );
    portalTokenB = await inviteAndActivate(
      internalTokenA,
      customerIdB,
      `portal.e2e.read.b.${randomUUID()}@orbit.local`,
    );

    const scenarioA = await createScenario({
      organizationId: organizationIdA,
      businessUnitId: unitIdA,
      customerId: customerIdA,
      ownerId: ownerIdA,
      marker: 'A',
    });
    operationIdA = scenarioA.operationId;
    deletedOperationIdA = scenarioA.deletedOperationId;
    assetIdA = scenarioA.assetId;
    pmocIdA = scenarioA.pmocId;
    rvtIdA = scenarioA.rvtId;
    documentIdA = scenarioA.documentId;

    const scenarioB = await createScenario({
      organizationId: organizationIdA,
      businessUnitId: unitIdA,
      customerId: customerIdB,
      ownerId: ownerIdA,
      marker: 'B',
    });
    operationIdB = scenarioB.operationId;
    assetIdB = scenarioB.assetId;
    pmocIdB = scenarioB.pmocId;
    rvtIdB = scenarioB.rvtId;
    documentIdB = scenarioB.documentId;

    const scenarioC = await createScenario({
      organizationId: organizationIdC,
      businessUnitId: unitIdC,
      customerId: customerIdC,
      ownerId: ownerIdC,
      marker: 'C',
    });
    operationIdC = scenarioC.operationId;
    assetIdC = scenarioC.assetId;
    documentIdC = scenarioC.documentId;
  });

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('returns Portal Me and a customer-scoped summary', async () => {
    const me = await portal(api().get('/api/v1/portal/me')).expect(200);
    expect((me.body as Envelope<any>).data).toMatchObject({
      actorType: 'CUSTOMER_PORTAL',
      organization: { id: organizationIdA },
      customer: { id: customerIdA },
    });
    const summary = await portal(api().get('/api/v1/portal/me/summary')).expect(
      200,
    );
    expect((summary.body as Envelope<any>).data).toMatchObject({
      assets: 1,
      activePmocPlans: 1,
      availableDocuments: 2,
    });
  });

  it('lists and details only own operations with a sanitized timeline', async () => {
    const list = await portal(
      api().get('/api/v1/portal/me/operations?limit=1&sortBy=code&order=asc'),
    ).expect(200);
    const result = (list.body as Envelope<any>).data;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: operationIdA,
      status: { code: 'completed', label: 'Concluído' },
      documentAvailable: true,
    });
    expect(result.meta).toMatchObject({ limit: 1, total: 1 });
    expect(JSON.stringify(result)).not.toContain(operationIdB);
    expect(JSON.stringify(result)).not.toContain(operationIdC);
    expect(JSON.stringify(result)).not.toContain(deletedOperationIdA);

    const detail = await portal(
      api().get(`/api/v1/portal/me/operations/${operationIdA}`),
    ).expect(200);
    expect((detail.body as Envelope<any>).data.timeline[0]).toMatchObject({
      event: 'Situação atualizada',
    });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /internalNote|allowedActions|blockedReason|cost|margin|capabilit|userId/i,
    );
  });

  it('returns hidden absence for cross-customer and cross-tenant operation IDs', async () => {
    await portal(
      api().get(`/api/v1/portal/me/operations/${operationIdB}`),
    ).expect(404);
    await portal(
      api().get(`/api/v1/portal/me/operations/${operationIdC}`),
    ).expect(404);
    await portal(
      api().get(`/api/v1/portal/me/operations/${deletedOperationIdA}`),
    ).expect(404);
  });

  it('exposes only own assets and bounded related summaries', async () => {
    const list = await portal(api().get('/api/v1/portal/me/assets')).expect(
      200,
    );
    const serialized = JSON.stringify((list.body as Envelope<any>).data);
    expect(serialized).toContain(assetIdA);
    expect(serialized).not.toContain(assetIdB);
    expect(serialized).not.toContain(assetIdC);

    const detail = await portal(
      api().get(`/api/v1/portal/me/assets/${assetIdA}`),
    ).expect(200);
    expect((detail.body as Envelope<any>).data.related).toMatchObject({
      operations: 1,
      pmocPlans: 1,
      rvtConfigurations: 1,
      documents: 2,
    });
    expect(JSON.stringify(detail.body)).not.toMatch(
      /specifications|inventory|depreciation|cost|margin/i,
    );
    await portal(api().get(`/api/v1/portal/me/assets/${assetIdB}`)).expect(404);
    await portal(api().get(`/api/v1/portal/me/assets/${assetIdC}`)).expect(404);
  });

  it('keeps PMOC semantic and customer-scoped', async () => {
    const list = await portal(api().get('/api/v1/portal/me/pmoc')).expect(200);
    const data = (list.body as Envelope<any>).data.data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id: pmocIdA, coveredAssets: 1 });
    expect(data[0].status.label).toBe('Ativo');
    expect(JSON.stringify(data)).not.toContain(pmocIdB);

    const detail = await portal(
      api().get(`/api/v1/portal/me/pmoc/${pmocIdA}`),
    ).expect(200);
    expect((detail.body as Envelope<any>).data.cycles[0]).toMatchObject({
      status: { code: 'completed', label: 'Concluído' },
      documentAvailable: true,
    });
    await portal(api().get(`/api/v1/portal/me/pmoc/${pmocIdB}`)).expect(404);
  });

  it('keeps RVT as visits and customer-scoped', async () => {
    const list = await portal(api().get('/api/v1/portal/me/rvt')).expect(200);
    const data = (list.body as Envelope<any>).data.data;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      id: rvtIdA,
      visitType: 'Semanal',
      completedVisits: 1,
    });
    expect(JSON.stringify(data)).not.toContain(rvtIdB);

    const detail = await portal(
      api().get(`/api/v1/portal/me/rvt/${rvtIdA}`),
    ).expect(200);
    expect((detail.body as Envelope<any>).data.visits[0]).toMatchObject({
      status: { code: 'completed', label: 'Realizada' },
      documentAvailable: true,
    });
    await portal(api().get(`/api/v1/portal/me/rvt/${rvtIdB}`)).expect(404);
  });

  it('lists only final active documents and revalidates ownership before signing', async () => {
    const list = await portal(api().get('/api/v1/portal/me/documents')).expect(
      200,
    );
    const data = (list.body as Envelope<{ data: Array<{ id: string }> }>).data
      .data;
    expect(data.map((item) => item.id)).toEqual(
      expect.arrayContaining([documentIdA]),
    );
    expect(JSON.stringify(data)).not.toContain(documentIdB);
    expect(JSON.stringify(data)).not.toContain(documentIdC);
    expect(JSON.stringify(data)).not.toMatch(
      /bucket|objectKey|storageKey|hash/i,
    );

    await portal(
      api().get(`/api/v1/portal/me/documents/${documentIdB}/access`),
    ).expect(404);
    await portal(
      api().get(`/api/v1/portal/me/documents/${documentIdC}/access`),
    ).expect(404);

    const access = await portal(
      api().get(`/api/v1/portal/me/documents/${documentIdA}/access`),
    ).expect(200);
    const signed = (access.body as Envelope<any>).data;
    expect(signed.method).toBe('GET');
    expect(
      new Date(signed.expiresAt).getTime() - Date.now(),
    ).toBeLessThanOrEqual(300_000);
    const signedUrl = new URL(signed.url);
    const download = await api()
      .get(`/api/v1/storage/objects${signedUrl.search}`)
      .expect(200);
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['content-disposition']).not.toContain('../');

    signedUrl.searchParams.set(
      'expires',
      String(Math.floor(Date.now() / 1_000) - 1),
    );
    await api().get(`/api/v1/storage/objects${signedUrl.search}`).expect(403);
  });

  it('enforces pagination, sorting and filter whitelists server-side', async () => {
    await portal(api().get('/api/v1/portal/me/assets?limit=51')).expect(400);
    await portal(api().get('/api/v1/portal/me/assets?page=0')).expect(400);
    await portal(api().get('/api/v1/portal/me/assets?sortBy=raw_sql')).expect(
      400,
    );
    await portal(
      api().get(`/api/v1/portal/me/assets?customerId=${customerIdB}`),
    ).expect(400);
    await portal(
      api().get(`/api/v1/portal/me/assets?organizationId=${organizationIdC}`),
    ).expect(400);
    await portal(
      api().get(`/api/v1/portal/me/assets?businessUnitId=${unitIdC}`),
    ).expect(400);
  });

  it('rejects internal JWTs and keeps the surface read-only', async () => {
    await portal(
      api().get('/api/v1/portal/me/operations'),
      internalTokenA,
    ).expect(401);
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      await portal(api()[method]('/api/v1/portal/me/operations')).expect(404);
    }
  });

  it('gives Customer B only its own resource graph', async () => {
    for (const resource of [
      'operations',
      'assets',
      'pmoc',
      'rvt',
      'documents',
    ]) {
      const response = await portal(
        api().get(`/api/v1/portal/me/${resource}`),
        portalTokenB,
      ).expect(200);
      const serialized = JSON.stringify((response.body as Envelope<any>).data);
      expect(serialized).not.toContain(customerIdA);
      expect(serialized).not.toContain(operationIdA);
      expect(serialized).not.toContain(assetIdA);
      expect(serialized).not.toContain(pmocIdA);
      expect(serialized).not.toContain(rvtIdA);
      expect(serialized).not.toContain(documentIdA);
    }
  });

  async function createTenant(marker: string) {
    const email = `portal.e2e.read.owner.${marker}.${randomUUID()}@orbit.local`;
    const registration = await api()
      .post('/api/v1/identity/register')
      .send({
        email,
        firstName: 'Portal',
        lastName: `Read ${marker}`,
        password: PASSWORD,
        organizationName: `Portal Read ${marker} ${randomUUID().slice(0, 6)}`,
        legalName: `Portal Read ${marker} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua dos Read Models',
        stateCode: 'PE',
      })
      .expect(201);
    const token = (registration.body as Envelope<any>).data.accessToken;
    const organization = await internal(
      api().get('/api/v1/organizations/current'),
      token,
    ).expect(200);
    const organizationId = (organization.body as Envelope<any>).data.id;
    const owner = await prisma.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
      select: { id: true },
    });
    const unit = await prisma.businessUnit.findFirstOrThrow({
      where: { organizationId, deletedAt: null },
      select: { id: true },
    });
    return { token, organizationId, ownerId: owner.id, unitId: unit.id };
  }

  async function createCustomer(token: string, legalName: string) {
    const response = await internal(api().post('/api/v1/customers'), token)
      .send({ type: 'COMPANY', legalName })
      .expect(201);
    return (response.body as Envelope<any>).data.id as string;
  }

  async function inviteAndActivate(
    token: string,
    customerId: string,
    email: string,
  ) {
    await internal(
      api().post(`/api/v1/customers/${customerId}/portal/invitations`),
      token,
    )
      .send({ email, displayName: 'Cliente Portal' })
      .expect(201);
    const activation = await api()
      .post('/api/v1/portal/auth/activate')
      .send({ token: delivery.invitation(email), password: PASSWORD })
      .expect(201);
    return (activation.body as Envelope<any>).data.accessToken as string;
  }

  async function createScenario(input: {
    organizationId: string;
    businessUnitId: string;
    customerId: string;
    ownerId: string;
    marker: string;
  }) {
    const now = new Date();
    const asset = await prisma.asset.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        customerId: input.customerId,
        category: 'AIR_CONDITIONER',
        name: `Equipamento Portal ${input.marker}`,
        manufacturer: 'Orbit',
        model: 'Portal-33',
        serialNumber: `PORTAL-${input.marker}-${randomUUID()}`,
        identifierType: 'INTERNAL_CODE',
        identifier: `EQ-${input.marker}-${randomUUID()}`,
        location: 'Recepção',
        status: 'ACTIVE',
      },
    });
    const operation = await prisma.operation.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        customerId: input.customerId,
        assets: { create: [{ assetId: asset.id }] },
        code: `OS-${input.marker}-${randomUUID()}`,
        kind: 'SERVICE_ORDER',
        title: `Atendimento Portal ${input.marker}`,
        description: 'Resumo publicável do atendimento',
        status: 'COMPLETED',
        priority: 'NORMAL',
        scheduledStart: new Date(now.getTime() - 3_600_000),
        scheduledEnd: now,
        startedAt: new Date(now.getTime() - 3_000_000),
        completedAt: now,
        responsibleFieldTechnicianId: input.ownerId,
        createdById: input.ownerId,
        location: {
          street: 'Rua Azul',
          city: 'Recife',
          internalNote: 'hidden',
        },
        data: { internalNote: 'never expose', cost: 9999, margin: 88 },
      },
    });
    await prisma.operationHistory.create({
      data: {
        id: generateUuidV7(),
        operationId: operation.id,
        userId: input.ownerId,
        action: 'STATUS_CHANGED',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'COMPLETED',
        details: { internalNote: 'never expose' },
      },
    });
    const deleted = await prisma.operation.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        customerId: input.customerId,
        code: `OS-DELETED-${input.marker}-${randomUUID()}`,
        kind: 'SERVICE_ORDER',
        title: 'Atendimento removido',
        status: 'OPEN',
        priority: 'NORMAL',
        createdById: input.ownerId,
        deletedAt: now,
      },
    });
    const pmoc = await prisma.$transaction(async (tx) => {
      const created = await tx.pmocPlan.create({
        data: {
          id: generateUuidV7(),
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId: input.customerId,
          code: `PMOC-${input.marker}-${randomUUID()}`,
          name: `Plano PMOC ${input.marker}`,
          status: 'ACTIVE',
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
          endsOn: new Date('2027-01-01T00:00:00.000Z'),
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          nextDueOn: new Date('2026-10-01T00:00:00.000Z'),
          activatedAt: now,
          createdById: input.ownerId,
        },
      });
      await tx.pmocEquipmentCoverage.create({
        data: {
          id: generateUuidV7(),
          organizationId: input.organizationId,
          planId: created.id,
          assetId: asset.id,
          startsOn: new Date('2026-01-01T00:00:00.000Z'),
        },
      });
      return created;
    });

    const artifact = await createArtifact(input, operation.id, asset.id, 'OS');
    const pmocExecution = await prisma.pmocExecution.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        planId: pmoc.id,
        dueOn: new Date('2026-09-01T00:00:00.000Z'),
        status: 'COMPLETED',
        sequenceNumber: 1,
        operationId: operation.id,
        artifactExecutionId: artifact.executionId,
        performedAt: now,
        completedById: input.ownerId,
      },
    });
    void pmocExecution;

    /**
     * O ritmo vem do catálogo da organização, não de um literal.
     *
     * `visitType` era um enum de dois valores traduzido no portal. Hoje o
     * rótulo que o cliente lê é o que o dono da conta cadastrou, e é isso que
     * este cenário precisa exercitar — um contrato sem tipo cairia no texto
     * genérico e o teste passaria sem provar nada.
     */
    const tipoSemanal = await prisma.rvtMaintenanceType.findFirstOrThrow({
      where: { organizationId: input.organizationId, key: 'WEEKLY' },
      select: { id: true },
    });
    const rvt = await prisma.rvtConfiguration.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        customerId: input.customerId,
        code: `RVT-${input.marker}-${randomUUID()}`,
        name: `Visitas RVT ${input.marker}`,
        maintenanceTypeId: tipoSemanal.id,
        scheduleMode: 'RECURRING',
        coverageStart: new Date('2026-01-01T00:00:00.000Z'),
        coverageEnd: new Date('2027-01-01T00:00:00.000Z'),
        timezone: 'America/Recife',
        serviceLocation: { city: 'Recife' },
        recurrence: { frequency: 1, unit: 'WEEK' },
        technicalResponsibleUserId: input.ownerId,
        defaultResponsibleFieldTechnicianId: input.ownerId,
        status: 'ACTIVE',
        createdById: input.ownerId,
      },
    });
    await prisma.rvtConfigurationEquipment.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        configurationId: rvt.id,
        assetId: asset.id,
      },
    });
    const occurrence = await prisma.rvtOccurrence.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        configurationId: rvt.id,
        sequenceNumber: 1,
        scheduledFor: now,
        localScheduledDate: new Date('2026-09-04T00:00:00.000Z'),
        status: 'COMPLETED',
      },
    });
    const rvtArtifact = await createArtifact(input, null, asset.id, 'RVT');
    await prisma.rvtExecution.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        occurrenceId: occurrence.id,
        artifactExecutionId: rvtArtifact.executionId,
        responsibleFieldTechnicianId: input.ownerId,
        technicalResponsibleUserId: input.ownerId,
        status: 'COMPLETED',
        procedureSnapshot: {},
        configurationSnapshot: {},
        performedAt: now,
        startedById: input.ownerId,
        completedById: input.ownerId,
        completedAt: now,
      },
    });

    return {
      operationId: operation.id,
      deletedOperationId: deleted.id,
      assetId: asset.id,
      pmocId: pmoc.id,
      rvtId: rvt.id,
      documentId: artifact.manifestId,
    };
  }

  async function createArtifact(
    input: {
      organizationId: string;
      businessUnitId: string;
      customerId: string;
      ownerId: string;
      marker: string;
    },
    operationId: string | null,
    assetId: string,
    kind: string,
  ) {
    const unique = randomUUID();
    const template = await prisma.artifactTemplate.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        createdById: input.ownerId,
        key: `portal-${kind.toLowerCase()}-${unique}`,
        name: `Documento ${kind} ${input.marker}`,
        artifactType: kind,
        status: 'ACTIVE',
        visibility: 'ORGANIZATION',
      },
    });
    const version = await prisma.artifactTemplateVersion.create({
      data: {
        id: generateUuidV7(),
        templateId: template.id,
        organizationId: input.organizationId,
        createdById: input.ownerId,
        version: 1,
        metadata: {},
        sections: [],
        signatureSlots: [],
        layout: {},
      },
    });
    const snapshot = await prisma.artifactSnapshot.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        templateId: template.id,
        templateVersionId: version.id,
        templateVersion: 1,
        templateKey: template.key,
        templateName: template.name,
        artifactType: kind,
        metadata: {},
        sections: [],
        signatureSlots: [],
        layout: {},
        structureHash: createHash('sha256').update(unique).digest('hex'),
      },
    });
    const execution = await prisma.artifactExecution.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        operationId,
        customerId: input.customerId,
        assetId,
        templateId: template.id,
        snapshotId: snapshot.id,
        createdById: input.ownerId,
        code: `DOC-${kind}-${unique}`,
        title: `Documento ${kind} ${input.marker}`,
        status: FINAL_STATUSES[1]!,
        progress: 100,
        completedAt: new Date(),
        renderStatus: 'READY',
      },
    });
    const fileName = `relatorio-${kind.toLowerCase()}-${input.marker}.pdf`;
    const objectKey = `${input.organizationId}/manifests/portal/${unique}.pdf`;
    const body = Buffer.from(`ORBIT PR-33 ${kind} ${input.marker}`);
    const stat = await storage.put({
      bucket: storage.defaultBucket,
      objectKey,
      body,
      mimeType: 'application/pdf',
    });
    const file = await prisma.storageFile.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        provider: storage.name,
        bucket: stat.bucket,
        objectKey: stat.objectKey,
        fileName,
        mimeType: 'application/pdf',
        sizeBytes: BigInt(body.length),
        sha256: createHash('sha256').update(body).digest('hex'),
        status: 'AVAILABLE',
        createdById: input.ownerId,
      },
    });
    const manifest = await prisma.artifactManifest.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        executionId: execution.id,
        snapshotId: snapshot.id,
        templateId: template.id,
        templateVersion: 1,
        revision: 1,
        status: 'ISSUED',
        renderer: 'portal-e2e',
        rendererVersion: '1',
        format: 'PDF',
        contentHash: createHash('sha256').update(body).digest('hex'),
        sourceHash: createHash('sha256')
          .update(`${unique}:source`)
          .digest('hex'),
        fileId: file.id,
        isActive: true,
        issuedAt: new Date(),
        issuedById: input.ownerId,
        createdById: input.ownerId,
      },
    });
    await prisma.artifactManifest.create({
      data: {
        id: generateUuidV7(),
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        executionId: execution.id,
        snapshotId: snapshot.id,
        templateId: template.id,
        templateVersion: 1,
        revision: 2,
        status: 'DRAFT',
        renderer: 'portal-e2e',
        format: 'PDF',
        sourceHash: createHash('sha256')
          .update(`${unique}:draft`)
          .digest('hex'),
        isActive: false,
        createdById: input.ownerId,
      },
    });
    return { executionId: execution.id, manifestId: manifest.id };
  }
});

function cnpj(): string {
  const base =
    Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('') +
    '0001';
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
    return rest < 2 ? '0' : `${11 - rest}`;
  };
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}
