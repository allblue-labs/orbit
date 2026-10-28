import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { PrismaService, RlsTransaction } from '../src/database';
import { RlsContextProvider } from '../src/database/rls/rls-context.provider';
import {
  RequestContext,
  RequestContextService,
  RequestContextStorage,
} from '../src/context';
import type { UUID } from '../src/contracts';
import { BackgroundJobQueue } from '../src/modules/jobs/background-job.queue';
import { DomainEventEmitter } from '../src/modules/automations/domain-event.emitter';
import { FileObjectService } from '../src/modules/storage/file-object.service';
import { StorageFileRepository } from '../src/modules/storage/file-object.repository';
import type {
  StorageProvider,
  PutObjectInput,
  StorageObjectRef,
} from '../src/modules/storage/storage.types';
import { QuoteRepository } from '../src/modules/quotes/quote.repository';
import { QuoteService } from '../src/modules/quotes/quote.service';
import { QuoteMapper } from '../src/modules/quotes/quote.mapper';
import { QuoteAcceptanceService } from '../src/modules/quotes/quote-acceptance.service';
import type { QuoteAcceptanceResponseDto } from '../src/modules/quotes/quote-acceptance.dto';
import { QuoteDocumentService } from '../src/modules/artifact-rendering/quote-document.service';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../src/exceptions';
import { HashHelper } from '../src/helpers';
import { PmocRepository } from '../src/modules/pmoc/pmoc.repository';
import { PmocService, type PmocActor } from '../src/modules/pmoc/pmoc.service';
import { PmocPlanDocumentService } from '../src/modules/artifact-rendering/pmoc-plan-document.service';

// Banco, RLS, transições, arquivo registrado e outbox reais. Apenas o bucket é
// em memória: nenhuma credencial ou infraestrutura de produção é utilizada.
describe('aceite público de propostas com RLS real', () => {
  const admin = adminPrisma();
  const contexts = new RequestContextStorage();
  const objects = new Map<string, Buffer>();
  let runtime: PrismaClient;
  let rls: RlsTransaction;
  let acceptance: QuoteAcceptanceService;
  let quotes: QuoteService;
  let pmoc: PmocService;
  let pmocRepository: PmocRepository;
  let userId: string;
  let signatureBase64: string;
  let sequence = 0;
  const tenants: {
    organizationId: string;
    unitId: string;
    customerId: string;
  }[] = [];
  const storage = {
    name: 'LOCAL',
    defaultBucket: 'test',
    put: jest.fn(({ objectKey, body }: PutObjectInput) => {
      objects.set(objectKey, body);
      return Promise.resolve({ sizeBytes: body.length });
    }),
    get: jest.fn(({ objectKey }: StorageObjectRef) => {
      const bytes = objects.get(objectKey);
      if (!bytes) throw new Error('missing object');
      return Promise.resolve(bytes);
    }),
  };
  const owner = <T>(work: () => Promise<T>, tenant = tenants[0]!) =>
    contexts.run(
      new RequestContext({
        requestId: randomUUID(),
        actorType: 'INTERNAL_USER',
        userId: userId as UUID,
        organizationId: tenant.organizationId as UUID,
        businessUnitId: tenant.unitId as UUID,
        businessUnitIds: [tenant.unitId as UUID],
        roles: ['ORGANIZATION_OWNER'],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      work,
    );

  beforeAll(async () => {
    if (!process.env.APP_DATABASE_URL)
      throw new Error('APP_DATABASE_URL restrita é obrigatória.');
    runtime = new PrismaClient({
      adapter: new PrismaPg(process.env.APP_DATABASE_URL),
    });
    const [role] = await runtime.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const suffix = randomUUID();
    const user = await admin.user.create({
      data: {
        email: `quotes.acceptance.${suffix}@orbit.local`,
        normalizedEmail: `quotes.acceptance.${suffix}@orbit.local`,
        firstName: 'Owner',
        lastName: 'Teste',
        displayName: 'Owner Teste',
        status: 'ACTIVE',
      },
    });
    userId = user.id;
    const plan = await admin.plan.findFirstOrThrow();
    for (const label of ['local', 'foreign']) {
      const organization = await admin.organization.create({
        data: {
          ownerUserId: userId,
          planId: plan.id,
          slug: `acceptance-${label}-${suffix}`,
          displayName: label,
          primarySegment: 'HVAC',
        },
      });
      const unit = await admin.businessUnit.create({
        data: {
          organizationId: organization.id,
          slug: 'matriz',
          legalName: 'Empresa de testes',
          documentType: 'CNPJ',
          documentNumber: '12345678000195',
          city: 'Recife',
          street: 'Rua de testes',
        },
      });
      const customer = await admin.customer.create({
        data: {
          organizationId: organization.id,
          legalName: `Cliente ${label}`,
        },
      });
      tenants.push({
        organizationId: organization.id,
        unitId: unit.id,
        customerId: customer.id,
      });
    }
    const contextService = new RequestContextService(contexts);
    rls = new RlsTransaction(
      runtime as PrismaService,
      new RlsContextProvider(contextService),
    );
    const jobs = new BackgroundJobQueue(runtime as PrismaService, rls);
    const repository = new QuoteRepository(
      rls,
      jobs,
      new DomainEventEmitter(jobs, contextService),
    );
    quotes = new QuoteService(
      repository,
      new QuoteDocumentService(),
      storage as unknown as StorageProvider,
    );
    const files = new FileObjectService(
      storage as unknown as StorageProvider,
      { provider: 'LOCAL', bucket: 'test' } as never,
      new StorageFileRepository(rls),
    );
    acceptance = new QuoteAcceptanceService(
      runtime as PrismaService,
      rls,
      contexts,
      quotes,
      repository,
      new QuoteMapper(),
      files,
    );
    pmocRepository = new PmocRepository(
      rls,
      contextService,
      new DomainEventEmitter(jobs, contextService),
      runtime as PrismaService,
    );
    pmoc = new PmocService(
      pmocRepository,
      undefined as never,
      jobs,
      undefined as never,
      undefined as never,
      new PmocPlanDocumentService(),
      storage as unknown as StorageProvider,
    );
    signatureBase64 = (
      await sharp({
        create: { width: 120, height: 40, channels: 4, background: '#123456' },
      })
        .png()
        .toBuffer()
    ).toString('base64');
  });
  afterAll(async () => {
    await runtime?.$disconnect();
    await admin.organization.deleteMany({
      where: { id: { in: tenants.map((t) => t.organizationId) } },
    });
    if (userId) await admin.user.delete({ where: { id: userId } });
    await disconnectAdminPrisma();
  });
  async function proposal() {
    const tenant = tenants[0]!;
    const number = ++sequence;
    const quote = await admin.quote.create({
      data: {
        organizationId: tenant.organizationId,
        businessUnitId: tenant.unitId,
        customerId: tenant.customerId,
        createdById: userId,
        number,
        code: `ORC-${number}`,
        title: 'Manutenção preventiva',
        subtotal: 250,
        total: 250,
        validUntil: new Date('2099-12-31'),
      },
    });
    await admin.quoteItem.create({
      data: {
        organizationId: tenant.organizationId,
        quoteId: quote.id,
        kind: 'SERVICE',
        description: 'Limpeza e testes',
        quantity: 1,
        unitPrice: 250,
        total: 250,
      },
    });
    const link = await owner(() =>
      acceptance.create(quote.id, tenant.organizationId, userId),
    );
    return { quote, link };
  }
  const approve = (): QuoteAcceptanceResponseDto => ({
    decision: 'APPROVE',
    signerName: 'Cliente Teste',
    consentAccepted: true,
    signatureBase64,
  });

  it('envia rascunho, congela resumo/PDF e guarda somente o hash do segredo', async () => {
    const { quote, link } = await proposal();
    expect(link.token).toHaveLength(64);
    const row = await admin.quoteAcceptanceLink.findFirstOrThrow({
      where: { quoteId: quote.id },
    });
    expect(row.tokenHash).toBe(HashHelper.sha256(link.token));
    expect(JSON.stringify(row)).not.toContain(link.token);
    expect((await acceptance.read(link.token)).proposal).toMatchObject({
      title: quote.title,
      total: '250.00',
      customerName: 'Cliente local',
    });
    expect(
      (await acceptance.document(link.token)).bytes.subarray(0, 4).toString(),
    ).toBe('%PDF');
    expect(
      (await admin.quote.findUniqueOrThrow({ where: { id: quote.id } })).status,
    ).toBe('SENT');
    expect(contexts.get()).toBeUndefined();
  });
  it('aprova uma única vez mesmo com respostas simultâneas; preserva assinatura, auditoria e outbox', async () => {
    const { quote, link } = await proposal();
    const results = await Promise.all([
      acceptance.respond(link.token, approve(), { ip: '127.0.0.1' }),
      acceptance.respond(link.token, approve(), {}),
    ]);
    expect(results.every((r) => r.state === 'COMPLETED')).toBe(true);
    const row = await admin.quoteAcceptanceLink.findFirstOrThrow({
      where: { quoteId: quote.id },
    });
    expect(row.signatureFileId).not.toBeNull();
    expect(row.consentAccepted).toBe(true);
    const approved = await admin.quote.findUniqueOrThrow({
      where: { id: quote.id },
    });
    expect(approved.status).toBe('APPROVED');
    expect(approved.decidedById).toBeNull();
    expect(
      await admin.domainEvent.count({
        where: { entityId: quote.id, type: 'quote.approved' },
      }),
    ).toBe(1);
    expect(
      await admin.backgroundJob.count({
        where: { jobKey: `${quote.id}:APPROVED` },
      }),
    ).toBe(1);
    const signedPdf = await owner(() =>
      quotes.document(quote.id, tenants[0]!.organizationId),
    );
    expect(signedPdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
    await expect(
      acceptance.respond(
        link.token,
        {
          decision: 'REJECT',
          signerName: 'Outra Pessoa',
          reason: 'Não autorizado',
        },
        {},
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await acceptance.read(link.token)).response?.signerName).toBe(
      'Cliente Teste',
    );
  });
  it.each(['REJECT', 'REQUEST_CHANGES'] as const)(
    'registra %s e aplica a transição correspondente sem evento de aprovação',
    async (decision) => {
      const { quote, link } = await proposal();
      const reason = 'Precisamos rever as condições. '.repeat(25);
      await acceptance.respond(
        link.token,
        { decision, signerName: 'Cliente Teste', reason },
        {},
      );
      expect(
        (await admin.quote.findUniqueOrThrow({ where: { id: quote.id } }))
          .status,
      ).toBe(decision === 'REJECT' ? 'REJECTED' : 'DRAFT');
      expect((await acceptance.read(link.token)).response).toMatchObject({
        decision,
        reason: reason.trim(),
      });
      expect(
        await admin.domainEvent.count({
          where: { entityId: quote.id, type: 'quote.approved' },
        }),
      ).toBe(0);
      if (decision === 'REQUEST_CHANGES') {
        const next = await owner(() =>
          acceptance.create(quote.id, tenants[0]!.organizationId, userId),
        );
        expect(next.token).not.toBe(link.token);
        expect((await acceptance.read(next.token)).state).toBe('AVAILABLE');
        expect((await acceptance.read(link.token)).response?.decision).toBe(
          'REQUEST_CHANGES',
        );
      }
    },
  );
  it('recusa falta de consentimento/assinatura/motivo sem alterar proposta ou registrar arquivo', async () => {
    const { quote, link } = await proposal();
    for (const input of [
      { ...approve(), consentAccepted: false },
      { ...approve(), signatureBase64: 'invalid' },
      {
        decision: 'REJECT',
        signerName: 'Cliente Teste',
        reason: '',
      } as QuoteAcceptanceResponseDto,
    ]) {
      await expect(
        acceptance.respond(link.token, input, {}),
      ).rejects.toBeInstanceOf(ValidationException);
    }
    expect(
      (await admin.quote.findUniqueOrThrow({ where: { id: quote.id } })).status,
    ).toBe('SENT');
    expect(
      (
        await admin.quoteAcceptanceLink.findFirstOrThrow({
          where: { quoteId: quote.id },
        })
      ).signatureFileId,
    ).toBeNull();
  });
  it('desfaz status, auditoria, arquivo e outbox se a persistência da resposta falhar', async () => {
    const { quote, link } = await proposal();
    const filesBefore = await admin.storageFile.count({
      where: { organizationId: tenants[0]!.organizationId },
    });
    await expect(
      acceptance.respond(
        link.token,
        { ...approve(), signerName: 'X'.repeat(181) },
        {},
      ),
    ).rejects.toThrow();
    expect(
      (await admin.quote.findUniqueOrThrow({ where: { id: quote.id } })).status,
    ).toBe('SENT');
    expect((await acceptance.read(link.token)).response).toBeNull();
    expect(
      await admin.storageFile.count({
        where: { organizationId: tenants[0]!.organizationId },
      }),
    ).toBe(filesBefore);
    expect(
      await admin.domainEvent.count({ where: { entityId: quote.id } }),
    ).toBe(0);
    expect(
      await admin.backgroundJob.count({
        where: { jobKey: `${quote.id}:APPROVED` },
      }),
    ).toBe(0);
    expect(
      await admin.auditLog.count({
        where: { entityId: quote.id, action: 'QUOTE_APPROVED' },
      }),
    ).toBe(0);
  });
  it('revoga link pendente anterior e impede aceite/download de links expirados ou alterados', async () => {
    const { quote, link } = await proposal();
    const next = await owner(() =>
      acceptance.create(quote.id, tenants[0]!.organizationId, userId),
    );
    expect(await acceptance.read(link.token)).toMatchObject({
      state: 'REVOKED',
      proposal: null,
    });
    await expect(
      acceptance.respond(link.token, approve(), {}),
    ).rejects.toBeInstanceOf(ConflictException);
    await admin.quoteAcceptanceLink.updateMany({
      where: { tokenHash: HashHelper.sha256(next.token) },
      data: { expiresAt: new Date(0) },
    });
    expect((await acceptance.read(next.token)).state).toBe('EXPIRED');
    await expect(acceptance.document(next.token)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const updated = await owner(() =>
      acceptance.create(quote.id, tenants[0]!.organizationId, userId),
    );
    await admin.quote.update({
      where: { id: quote.id },
      data: { title: 'Outro escopo' },
    });
    expect(await acceptance.read(updated.token)).toMatchObject({
      state: 'UPDATED',
      proposal: null,
    });
    await expect(
      acceptance.respond(updated.token, approve(), {}),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('não permite ao outro tenant gerar/ler respostas; acesso sem token não enxerga tabela; não vaza contexto público', async () => {
    const { quote, link } = await proposal();
    await expect(
      owner(
        () => acceptance.latest(quote.id, tenants[1]!.organizationId),
        tenants[1],
      ),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    await expect(
      owner(
        () => acceptance.create(quote.id, tenants[1]!.organizationId, userId),
        tenants[1],
      ),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(await runtime.quoteAcceptanceLink.count()).toBe(0);
    await expect(acceptance.read('x'.repeat(64))).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
    await expect(acceptance.read('short')).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
    const foreignRead = () =>
      owner(
        () =>
          rls.run(async (tx) =>
            expect(await tx.quoteAcceptanceLink.count()).toBe(0),
          ),
        tenants[1],
      );
    await Promise.all([acceptance.read(link.token), foreignRead()]);
    expect(contexts.get()).toBeUndefined();
  });
  it('congela e baixa contrato PMOC, coleta aceite opcional e conserva a prova anterior após alteração', async () => {
    const tenant = tenants[0]!;
    const plan = await admin.pmocPlan.create({
      data: {
        organizationId: tenant.organizationId,
        businessUnitId: tenant.unitId,
        customerId: tenant.customerId,
        createdById: userId,
        code: 'PMOC-ACEITE',
        name: 'Manutenção mensal',
        startsOn: new Date('2026-10-01'),
        frequencyAmount: 1,
        frequencyUnit: 'MONTHS',
      },
    });
    const asset = await admin.asset.create({
      data: {
        organizationId: tenant.organizationId,
        businessUnitId: tenant.unitId,
        customerId: tenant.customerId,
        name: 'Split teste',
        category: 'EQUIPMENT',
      },
    });
    await admin.pmocEquipmentCoverage.create({
      data: {
        organizationId: tenant.organizationId,
        planId: plan.id,
        assetId: asset.id,
        startsOn: plan.startsOn,
      },
    });
    const actor: PmocActor = {
      organizationId: tenant.organizationId,
      actorId: userId,
      businessUnitIds: [tenant.unitId],
      permissions: ['pmoc.manage'],
      isOrganizationOwner: true,
    };
    const link = await owner(() => pmoc.createSignatureLink(plan.id, actor));
    expect(await pmoc.publicContract(link.token)).toMatchObject({
      state: 'VALIDO',
      documentAvailable: true,
      plan: { name: 'Manutenção mensal', coveredEquipment: 1 },
    });
    expect(
      (await pmoc.publicContractDocument(link.token)).bytes
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    const sign = () =>
      pmoc.signPublicContract(link.token, {
        signerName: 'Cliente PMOC',
        signature: Buffer.from(signatureBase64, 'base64'),
        mimeType: 'image/png',
      });
    const replies = await Promise.all([sign(), sign()]);
    expect(replies.map((r) => r.state).sort()).toEqual([
      'JA_ASSINADO',
      'VALIDO',
    ]);
    expect(
      await owner(() =>
        pmocRepository.latestSignature(plan.id, tenant.organizationId),
      ),
    ).toMatchObject({ signerName: 'Cliente PMOC' });
    const row = await admin.pmocPlanSignatureLink.findFirstOrThrow({
      where: { planId: plan.id },
    });
    const original = await pmoc.publicContractDocument(link.token);
    await owner(() =>
      pmocRepository.update(
        plan.id,
        tenant.organizationId,
        userId,
        { name: 'Contrato revisado' },
        'PMOC_PLAN_UPDATED',
        {},
      ),
    );
    expect(
      await owner(() =>
        pmocRepository.latestSignature(plan.id, tenant.organizationId),
      ),
    ).toBeNull();
    expect((await pmoc.publicContract(link.token)).plan.name).toBe(
      'Manutenção mensal',
    );
    expect((await pmoc.publicContractDocument(link.token)).bytes).toEqual(
      original.bytes,
    );
    expect(
      (
        await admin.pmocPlanSignatureLink.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).revokedAt,
    ).not.toBeNull();
    // Não altera o ciclo operacional do plano: assinatura é aceite, não ativação.
    expect(
      (await admin.pmocPlan.findUniqueOrThrow({ where: { id: plan.id } }))
        .status,
    ).toBe('DRAFT');
    const updated = await owner(() => pmoc.createSignatureLink(plan.id, actor));
    await owner(() =>
      pmocRepository.update(
        plan.id,
        tenant.organizationId,
        userId,
        { name: 'Outra revisão' },
        'PMOC_PLAN_UPDATED',
        {},
      ),
    );
    expect((await pmoc.publicContract(updated.token)).state).toBe('REVOGADO');
    await expect(
      pmoc.publicContractDocument(updated.token),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(
      (
        await pmoc.signPublicContract(updated.token, {
          signerName: 'Cliente PMOC',
          signature: Buffer.from(signatureBase64, 'base64'),
          mimeType: 'image/png',
        })
      ).state,
    ).toBe('REVOGADO');
  });
});
