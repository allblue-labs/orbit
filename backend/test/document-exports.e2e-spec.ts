/**
 * Exportação assíncrona de documentos, ponta a ponta.
 *
 * - `POST …/document/exports` responde 202 com o identificador;
 * - o worker gera, envia ao armazenamento e fecha o registro;
 * - a consulta devolve URL assinada de 300 s, e o arquivo baixado é o PDF;
 * - a rota síncrona antiga continua respondendo igual;
 * - a organização vizinha não enxerga a exportação;
 * - o limite de pendentes por organização responde 429;
 * - a limpeza apaga o registro e depois o arquivo.
 */
import { registerVerifiedOwner } from './support/verified-owner-fixture';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApiVersioning } from './../src/configure-api';
import { BackgroundJobWorker } from './../src/modules/jobs/background-job.worker';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { memberFixture } from './support/member-fixture';
import { RequestContext, RequestContextStorage } from './../src/context';
import type { UUID } from './../src/contracts';
import { RlsTransaction } from './../src/database';

const digits = (length: number): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');

function cnpj(): string {
  const base = digits(8) + '0001';
  const check = (numbers: string): number => {
    const weights =
      numbers.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = numbers
      .split('')
      .reduce(
        (total, digit, index) => total + Number(digit) * (weights[index] ?? 0),
        0,
      );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = check(base);
  return `${base}${first}${check(`${base}${first}`)}`;
}

interface Envelope<T> {
  data: T;
}
interface Tenant {
  token: string;
  email: string;
  password: string;
  organizationId: string;
  businessUnitId: string;
  customerId: string;
}
interface Accepted {
  exportId: string;
  jobId: string;
  status: string;
}
interface Status {
  exportId: string;
  kind: string;
  status: string;
  fileName: string | null;
  contentType: string | null;
  errorCode: string | null;
  expiresAt: string;
  download: { url: string; expiresAt: string } | null;
}

const PENDING_LIMIT = 3;

describe('Exportação assíncrona de documentos (e2e)', () => {
  let app: INestApplication<App>;
  let worker: BackgroundJobWorker;
  let http: () => request.Agent;
  let tenant: Tenant;
  let neighbour: Tenant;

  const auth = (req: request.Test, token: string) =>
    req.set('Authorization', `Bearer ${token}`);

  async function register(label: string): Promise<Tenant> {
    const suffix = randomUUID().slice(0, 8);
    const email = `exports.${label}.${suffix}@orbit.local`;
    const registration = await registerVerifiedOwner(app, {
      ...REGISTRATION_LEGAL_ACCEPTANCE,
      email,
      firstName: 'Export',
      lastName: 'E2E',
      password: 'Orbit#Export@2026',
      organizationName: `Export ${label} ${suffix}`,
      legalName: `Export ${label} ${suffix} LTDA`,
      documentType: 'CNPJ',
      documentNumber: cnpj(),
      city: 'Recife',
      street: 'Rua da Aurora',
      stateCode: 'PE',
    });
    const token = (registration.body as Envelope<{ accessToken: string }>).data
      .accessToken;
    const organization = await auth(
      http().get('/api/v1/organizations/current'),
      token,
    ).expect(200);
    const current = (
      organization.body as Envelope<{
        id: string;
        businessUnits: { id: string }[];
      }>
    ).data;
    const businessUnitId = current.businessUnits[0]!.id;
    const customer = await auth(http().post('/api/v1/customers'), token)
      .send({
        legalName: `Cliente ${suffix} LTDA`,
        tradeName: `Cliente ${suffix}`,
        type: 'COMPANY',
        documentType: 'CNPJ',
        documentNumber: cnpj(),
      })
      .expect(201);
    return {
      token,
      email,
      password: 'Orbit#Export@2026',
      organizationId: current.id,
      businessUnitId,
      customerId: (customer.body as Envelope<{ id: string }>).data.id,
    };
  }

  async function createQuote(who: Tenant) {
    const response = await auth(http().post('/api/v1/quotes'), who.token)
      .send({
        customerId: who.customerId,
        businessUnitId: who.businessUnitId,
        title: 'Manutenção preventiva anual',
        validUntil: '2099-12-31',
      })
      .expect(201);
    return (response.body as Envelope<{ id: string; code: string }>).data;
  }

  const status = async (who: Tenant, id: string, expected = 200) =>
    (
      (
        await auth(
          http().get(`/api/v1/document-exports/${id}`),
          who.token,
        ).expect(expected)
      ).body as Envelope<Status>
    ).data;

  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    process.env.DOCUMENT_EXPORTS_PENDING_PER_ORG = String(PENDING_LIMIT);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    http = () => request(app.getHttpServer());
    worker = app.get(BackgroundJobWorker);
    tenant = await register('principal');
    neighbour = await register('vizinha');
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('202, worker gera, URL assinada de 300 s e o PDF baixado', async () => {
    const quote = await createQuote(tenant);

    const accepted = await auth(
      http().post(`/api/v1/quotes/${quote.id}/document/exports`),
      tenant.token,
    ).expect(202);
    const pedido = (accepted.body as Envelope<Accepted>).data;
    expect(pedido.status).toBe('PENDING');
    expect(pedido.jobId).toBeTruthy();

    expect((await status(tenant, pedido.exportId)).status).toBe('PENDING');

    await worker.tick();
    const pronto = await status(tenant, pedido.exportId);
    expect(pronto).toMatchObject({
      kind: 'QUOTE',
      status: 'COMPLETED',
      contentType: 'application/pdf',
      fileName: `${quote.code}.pdf`,
      errorCode: null,
    });
    const validade =
      new Date(pronto.download!.expiresAt).getTime() - Date.now();
    expect(validade).toBeGreaterThan(250_000);
    expect(validade).toBeLessThanOrEqual(300_000);

    const url = new URL(pronto.download!.url);
    const baixado = await http()
      .get(`${url.pathname}${url.search}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((baixado.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    /* A rota síncrona antiga segue respondendo o PDF. */
    const sincrono = await auth(
      http().get(`/api/v1/quotes/${quote.id}/document`),
      tenant.token,
    ).expect(200);
    expect(sincrono.headers['content-type']).toContain('application/pdf');
  }, 120000);

  it('a organização vizinha não enxerga a exportação', async () => {
    const quote = await createQuote(tenant);
    const accepted = await auth(
      http().post(`/api/v1/quotes/${quote.id}/document/exports`),
      tenant.token,
    ).expect(202);
    const { exportId } = (accepted.body as Envelope<Accepted>).data;

    await status(neighbour, exportId, 404);
    /* Nem pedir a exportação do orçamento alheio. */
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/document/exports`),
      neighbour.token,
    ).expect(404);
    await worker.tick();
  }, 60000);

  it('passando do limite de pendentes por organização, 429', async () => {
    const quote = await createQuote(neighbour);
    for (let i = 0; i < PENDING_LIMIT; i++)
      await auth(
        http().post(`/api/v1/quotes/${quote.id}/document/exports`),
        neighbour.token,
      ).expect(202);
    await auth(
      http().post(`/api/v1/quotes/${quote.id}/document/exports`),
      neighbour.token,
    ).expect(429);
    /* A outra organização não é afetada pelo limite desta. */
    const daOutra = await createQuote(tenant);
    await auth(
      http().post(`/api/v1/quotes/${daOutra.id}/document/exports`),
      tenant.token,
    ).expect(202);
    for (let i = 0; i < 4; i++) await worker.tick();
  }, 120000);

  it('a limpeza apaga o registro antes do arquivo', async () => {
    const quote = await createQuote(tenant);
    const accepted = await auth(
      http().post(`/api/v1/quotes/${quote.id}/document/exports`),
      tenant.token,
    ).expect(202);
    const { exportId } = (accepted.body as Envelope<Accepted>).data;
    await worker.tick();
    expect((await status(tenant, exportId)).status).toBe('COMPLETED');

    const admin = adminPrisma();
    const row = await admin.documentExport.findUniqueOrThrow({
      where: { id: exportId },
    });
    /* Vence agora: a limpeza agendada para o vencimento fica elegível. */
    await admin.backgroundJob.updateMany({
      where: { jobKey: `document-export-cleanup:${exportId}` },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    await worker.tick();

    expect(
      await admin.documentExport.findUnique({ where: { id: exportId } }),
    ).toBeNull();
    const file = await admin.storageFile.findUniqueOrThrow({
      where: { id: row.storageFileId! },
    });
    expect(file.deletedAt).not.toBeNull();
    await status(tenant, exportId, 404);
  }, 60000);

  async function proposalToken(who: Tenant) {
    const quote = await createQuote(who);
    await auth(http().post(`/api/v1/quotes/${quote.id}/items`), who.token)
      .send({ description: 'Limpeza e testes', quantity: 1, unitPrice: 250 })
      .expect(201);
    const link = await auth(
      http().post(`/api/v1/quotes/${quote.id}/acceptance-link`),
      who.token,
    ).expect(201);
    return (link.body as Envelope<{ token: string }>).data.token;
  }

  it('link público: o token abre o contexto do tenant; a exportação só vale para o próprio link', async () => {
    const token = await proposalToken(tenant);
    const outroToken = await proposalToken(tenant);
    const base = `/api/v1/public/quotes/proposals`;

    const accepted = await http()
      .post(`${base}/${token}/document/exports`)
      .expect(202);
    const { exportId } = (accepted.body as Envelope<Accepted>).data;

    const linha = await adminPrisma().documentExport.findUniqueOrThrow({
      where: { id: exportId },
    });
    expect(linha).toMatchObject({ kind: 'QUOTE_ACCEPTED', requestedBy: null });
    expect(linha.acceptanceLinkId).toBeTruthy();

    await worker.tick();
    const pronto = (
      (
        await http()
          .get(`${base}/${token}/document/exports/${exportId}`)
          .expect(200)
      ).body as Envelope<Status>
    ).data;
    expect(pronto.status).toBe('COMPLETED');
    expect(pronto.download?.url).toBeTruthy();

    /* Outro link da mesma organização não enxerga esta exportação. */
    await http()
      .get(`${base}/${outroToken}/document/exports/${exportId}`)
      .expect(404);
    /* Nem a rota autenticada: exportação de link público é só pelo token. */
    await status(tenant, exportId, 404);
    /* Token inválido não abre contexto nenhum. */
    await http()
      .post(`${base}/${'x'.repeat(64)}/document/exports`)
      .expect(404);
    /* A rota síncrona pública continua respondendo. */
    await http().get(`${base}/${token}/document`).expect(200);
  }, 120000);

  it('etiqueta do equipamento em PNG, com os mesmos parâmetros da rota síncrona', async () => {
    const created = await auth(http().post('/api/v1/assets'), tenant.token)
      .send({
        businessUnitId: tenant.businessUnitId,
        customerId: tenant.customerId,
        category: 'EQUIPMENT',
        name: 'Split recepção',
        identifierType: 'INTERNAL_CODE',
        identifier: `EQ-${digits(8)}`,
      })
      .expect(201);
    const assetId = (created.body as Envelope<{ id: string }>).data.id;

    const accepted = await auth(
      http().post(`/api/v1/assets/${assetId}/qr/exports`),
      tenant.token,
    )
      .send({ format: 'png', preset: 'SMALL' })
      .expect(202);
    const { exportId } = (accepted.body as Envelope<Accepted>).data;
    await worker.tick();

    const pronto = await status(tenant, exportId);
    expect(pronto).toMatchObject({
      kind: 'EQUIPMENT_QR',
      status: 'COMPLETED',
      contentType: 'image/png',
    });
    await auth(
      http().post(`/api/v1/assets/${assetId}/qr/exports`),
      neighbour.token,
    )
      .send({ format: 'png' })
      .expect(404);
  }, 120000);

  /** Esvazia a fila: os cenários seguintes contam pendentes do zero. */
  async function drain() {
    for (let i = 0; i < 6; i++) await worker.tick();
  }

  async function login(email: string, password: string, client = 'WEB') {
    const session = await http()
      .post('/api/v1/identity/login')
      .send({ email, password, client })
      .expect(200);
    return (session.body as Envelope<{ accessToken: string }>).data.accessToken;
  }

  async function downloaded(download: { url: string }) {
    const url = new URL(download.url);
    const response = await http()
      .get(`${url.pathname}${url.search}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    return response.body as Buffer;
  }

  it('plano PMOC: 202, processamento, consulta e PDF pela URL assinada', async () => {
    await drain();
    const admin = adminPrisma();
    const owner = await admin.user.findFirstOrThrow({
      where: { email: tenant.email },
      select: { id: true },
    });
    await auth(
      http().patch(
        `/api/v1/workforce/members/${owner.id}/professional-profile`,
      ),
      tenant.token,
    )
      .send({
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      })
      .expect(200);
    const created = await auth(http().post('/api/v1/pmoc/plans'), tenant.token)
      .send({
        businessUnitId: tenant.businessUnitId,
        customerId: tenant.customerId,
        code: `PMOC-${digits(6)}`,
        name: 'Climatização — administrativo',
        technicalResponsibleUserId: owner.id,
        startsOn: new Date().toISOString().slice(0, 10),
        frequencyAmount: 6,
        frequencyUnit: 'MONTHS',
      })
      .expect(201);
    const planId = (created.body as Envelope<{ id: string }>).data.id;

    const accepted = await auth(
      http().post(`/api/v1/pmoc/plans/${planId}/document/exports`),
      tenant.token,
    ).expect(202);
    const { exportId } = (accepted.body as Envelope<Accepted>).data;
    await worker.tick();

    const pronto = await status(tenant, exportId);
    expect(pronto).toMatchObject({
      kind: 'PMOC_PLAN',
      status: 'COMPLETED',
      contentType: 'application/pdf',
    });
    const pdf = await downloaded(pronto.download!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    /* A rota síncrona do plano segue respondendo. */
    await auth(
      http().get(`/api/v1/pmoc/plans/${planId}/document`),
      tenant.token,
    ).expect(200);
  }, 120000);

  it('rota do app: sessão MOBILE pede, acompanha e baixa o orçamento', async () => {
    await drain();
    const quote = await createQuote(tenant);
    const mobile = await login(tenant.email, tenant.password, 'MOBILE');

    const accepted = await auth(
      http().post(`/api/v1/mobile/field/quotes/${quote.id}/document/exports`),
      mobile,
    ).expect(202);
    const { exportId } = (accepted.body as Envelope<Accepted>).data;
    await worker.tick();

    const pronto = (
      (
        await auth(
          http().get(`/api/v1/document-exports/${exportId}`),
          mobile,
        ).expect(200)
      ).body as Envelope<Status>
    ).data;
    expect(pronto).toMatchObject({ kind: 'QUOTE', status: 'COMPLETED' });
    const pdf = await downloaded(pronto.download!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    /* O orçamento de outra organização não é alcançável pelo app. */
    const alheio = await createQuote(neighbour);
    await auth(
      http().post(`/api/v1/mobile/field/quotes/${alheio.id}/document/exports`),
      mobile,
    ).expect(404);
    /* A rota síncrona do app segue respondendo. */
    await auth(
      http().get(`/api/v1/mobile/field/quotes/${quote.id}/document`),
      mobile,
    ).expect(200);
  }, 120000);

  it('membros de filiais diferentes batem juntos no teto da organização', async () => {
    await drain();
    const admin = adminPrisma();
    const ownerId = (
      await admin.user.findFirstOrThrow({
        where: { email: tenant.email },
        select: { id: true },
      })
    ).id;
    const membership = await admin.businessUnitMembership.findFirstOrThrow({
      where: { userId: ownerId, businessUnitId: tenant.businessUnitId },
      select: { roleId: true },
    });
    const filial = await admin.businessUnit.create({
      data: {
        organizationId: tenant.organizationId,
        slug: `filial-${digits(6)}`,
        type: 'BRANCH',
        legalName: `Filial ${digits(4)} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
      },
      select: { id: true },
    });
    await admin.businessUnitMembership.create({
      data: {
        organizationId: tenant.organizationId,
        businessUnitId: filial.id,
        userId: ownerId,
        roleId: membership.roleId,
      },
    });
    const ownerToken = await login(tenant.email, tenant.password);
    const naMatriz = await createQuote(tenant);
    const naFilial = (
      (
        await auth(http().post('/api/v1/quotes'), ownerToken)
          .send({
            customerId: tenant.customerId,
            businessUnitId: filial.id,
            title: 'Instalação na filial',
            validUntil: '2099-12-31',
          })
          .expect(201)
      ).body as Envelope<{ id: string }>
    ).data;

    const senha = 'Orbit#Membro@2026';
    const daMatriz = await memberFixture(admin, {
      organizationId: tenant.organizationId,
      businessUnitIds: [tenant.businessUnitId],
      permissions: ['quotes.read'],
      password: senha,
    });
    const daFilial = await memberFixture(admin, {
      organizationId: tenant.organizationId,
      businessUnitIds: [filial.id],
      permissions: ['quotes.read'],
      password: senha,
    });
    const matriz = await login(daMatriz.email, senha);
    const filialToken = await login(daFilial.email, senha);

    for (let i = 0; i < PENDING_LIMIT - 1; i++)
      await auth(
        http().post(`/api/v1/quotes/${naMatriz.id}/document/exports`),
        matriz,
      ).expect(202);
    await auth(
      http().post(`/api/v1/quotes/${naFilial.id}/document/exports`),
      filialToken,
    ).expect(202);

    /* A filial só enxerga 1 pendente pelo RLS, mas a organização já tem 3. */
    const visiveisNaFilial = await auth(
      http().post(`/api/v1/quotes/${naFilial.id}/document/exports`),
      filialToken,
    );
    expect(visiveisNaFilial.status).toBe(429);
    await auth(
      http().post(`/api/v1/quotes/${naMatriz.id}/document/exports`),
      matriz,
    ).expect(429);
    await drain();
  }, 120000);

  it('a contagem da organização recusa olhar outra organização', async () => {
    const rls = app.get(RlsTransaction);
    const contexts = app.get(RequestContextStorage);
    const contexto = new RequestContext({
      requestId: randomUUID(),
      actorType: 'SYSTEM',
      userId: null,
      organizationId: tenant.organizationId as UUID,
      businessUnitId: tenant.businessUnitId as UUID,
      businessUnitIds: [tenant.businessUnitId as UUID],
      roles: [],
      permissions: [],
      ip: null,
      userAgent: null,
      locale: 'pt-BR',
    });
    const contar = (organizationId: string) =>
      contexts.run(contexto, () =>
        rls.run(
          (tx) => tx.$queryRaw<{ total: number }[]>`
            SELECT app_document_exports_in_progress(${organizationId}::uuid) AS total`,
        ),
      );

    await expect(contar(tenant.organizationId)).resolves.toEqual([
      { total: expect.any(Number) as number },
    ]);
    await expect(contar(neighbour.organizationId)).rejects.toThrow(
      /DOCUMENT_EXPORTS_CROSS_TENANT/,
    );
  });
});
