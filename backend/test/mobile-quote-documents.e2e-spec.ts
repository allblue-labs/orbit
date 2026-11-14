import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID, randomInt } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
import { MOBILE_QUOTE_DOCUMENTS_PERMISSION as permission } from '../src/common/mobile-document-permissions';

const password = 'Orbit#Documents@2026';
const data = <T>(response: request.Response) =>
  (response.body as { data: T }).data;
function cpf() {
  const digits = Array.from({ length: 9 }, () => randomInt(10));
  for (let length = 9; length <= 10; length++) {
    const mod =
      (digits.reduce((sum, n, i) => sum + n * (length + 1 - i), 0) * 10) % 11;
    digits.push(mod === 10 ? 0 : mod);
  }
  return digits.join('');
}
interface Tenant {
  token: string;
  unit: string;
  customer: string;
  quote: string;
}
interface Role {
  id: string;
  permissions: string[];
}

describe('orçamentos e equipamentos no aplicativo (HTTP e RLS)', () => {
  let app: INestApplication<App>;
  let principal: Tenant;
  let neighbor: Tenant;
  let operator: {
    id: string;
    token: string;
    email: string;
    permissions: string[];
  };
  const admin = adminPrisma();
  const http = () => request(app.getHttpServer());
  const auth = (test: request.Test, token = principal.token) =>
    test.set('Authorization', `Bearer ${token}`);
  async function tenant(): Promise<Tenant> {
    const suffix = randomUUID();
    const registered = await http()
      .post('/api/v1/identity/register')
      .send({
        ...REGISTRATION_LEGAL_ACCEPTANCE,
        email: `quotes.docs.${suffix}@orbit.local`,
        firstName: 'Owner',
        lastName: 'Documentos',
        password,
        organizationName: `Documentos ${suffix}`,
        legalName: 'Documentos de teste',
        documentType: 'CPF',
        documentNumber: cpf(),
        city: 'Recife',
        street: 'Rua de teste',
        stateCode: 'PE',
        planKey: 'ESSENTIAL',
      })
      .expect(201);
    const token = data<{ accessToken: string }>(registered).accessToken;
    const current = await auth(
      http().get('/api/v1/organizations/current'),
      token,
    ).expect(200);
    const unit = data<{ businessUnits: { id: string }[] }>(current)
      .businessUnits[0]!.id;
    const created = await auth(http().post('/api/v1/customers'), token)
      .send({ type: 'COMPANY', legalName: `Cliente ${suffix}` })
      .expect(201);
    const customer = data<{ id: string }>(created).id;
    const quoteResponse = await auth(http().post('/api/v1/quotes'), token)
      .send({
        customerId: customer,
        businessUnitId: unit,
        title: `Proposta ${suffix}`,
        validUntil: '2099-12-31',
      })
      .expect(201);
    return {
      token,
      unit,
      customer,
      quote: data<{ id: string }>(quoteResponse).id,
    };
  }
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
    principal = await tenant();
    neighbor = await tenant();
    const roles = data<(Role & { key: string })[]>(
      await auth(http().get('/api/v1/organizations/current/roles')).expect(200),
    );
    const role = roles.find((r) => r.key === 'FIELD_TECHNICIAN')!;
    expect(role.permissions).not.toContain(permission);
    const member = await auth(
      http().post('/api/v1/organizations/current/team/members'),
    )
      .send({
        email: `quotes.operator.${randomUUID()}@orbit.local`,
        firstName: 'Tecnico',
        lastName: 'Orcamentos',
        roleId: role.id,
      })
      .expect(201);
    const credentials = data<{
      member: { userId: string; email: string };
      temporaryPassword: string;
    }>(member);
    const session = await http()
      .post('/api/v1/identity/login')
      .send({
        email: credentials.member.email,
        password: credentials.temporaryPassword,
        client: 'MOBILE',
      })
      .expect(200);
    const token = data<{ accessToken: string }>(session).accessToken;
    await auth(http().post('/api/v1/identity/me/password'), token)
      .send({
        currentPassword: credentials.temporaryPassword,
        newPassword: password,
      })
      .expect(204);
    operator = {
      id: credentials.member.userId,
      email: credentials.member.email,
      token,
      permissions: role.permissions,
    };
  }, 120_000);
  afterAll(async () => {
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  it('owner vê e baixa o orçamento da web; outro tenant não alcança o PDF', async () => {
    const listed = await auth(
      http().get('/api/v1/mobile/field/documents?type=QUOTE'),
    ).expect(200);
    expect(
      data<{ data: { artifactId: string }[] }>(listed).data.map(
        (d) => d.artifactId,
      ),
    ).toEqual([principal.quote]);
    const pdf = await auth(
      http().get(`/api/v1/mobile/field/quotes/${principal.quote}/document`),
    )
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await auth(
      http().get(`/api/v1/mobile/field/quotes/${neighbor.quote}/document`),
    ).expect(404);
  });
  it('owner controla cada orçamento, em qualquer status, sem mudar a versão comercial', async () => {
    const list = () =>
      auth(
        http().get('/api/v1/mobile/field/documents?type=QUOTE'),
        operator.token,
      );
    const download = () =>
      auth(
        http().get(`/api/v1/mobile/field/quotes/${principal.quote}/document`),
        operator.token,
      );
    expect(data<{ data: unknown[] }>(await list().expect(200)).data).toEqual(
      [],
    );
    await download().expect(404);
    const before = await admin.quote.findUniqueOrThrow({
      where: { id: principal.quote },
    });
    const access = (visible: boolean, token = principal.token) =>
      auth(
        http().patch(`/api/v1/quotes/${principal.quote}/mobile-access`),
        token,
      ).send({ mobileVisible: visible });
    await access(true, operator.token).expect(403);
    await auth(http().patch(`/api/v1/quotes/${principal.quote}/mobile-access`))
      .send({ mobileVisible: 'true' })
      .expect(400);
    await access(true).expect(200);
    const visible = data<{
      data: { artifactId: string; status: string; statusLabel: string }[];
    }>(await list().expect(200)).data;
    expect(visible).toEqual([
      expect.objectContaining({
        artifactId: principal.quote,
        status: 'DRAFT',
        statusLabel: 'Rascunho',
      }),
    ]);
    await download()
      .expect(200)
      .expect('Content-Type', /application\/pdf/);
    const after = await admin.quote.findUniqueOrThrow({
      where: { id: principal.quote },
    });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.status).toBe('DRAFT');
    await auth(http().patch(`/api/v1/quotes/${neighbor.quote}/mobile-access`))
      .send({ mobileVisible: true })
      .expect(404);
    await auth(
      http().get(`/api/v1/mobile/field/quotes/${neighbor.quote}/document`),
      operator.token,
    ).expect(404);
    await access(false).expect(200);
    expect(data<{ data: unknown[] }>(await list().expect(200)).data).toEqual(
      [],
    );
    await download().expect(404);
    // The owner still sees it without any opt-in and without changing sessions.
    expect(
      data<{ data: { artifactId: string }[] }>(
        await auth(
          http().get('/api/v1/mobile/field/documents?type=QUOTE'),
        ).expect(200),
      ).data.map((row) => row.artifactId),
    ).toContain(principal.quote);
  });
  it('uma permissão antiga do operador não contorna a autorização por orçamento', async () => {
    await auth(
      http().patch(`/api/v1/organizations/current/members/${operator.id}`),
    )
      .send({
        useRoleDefaults: false,
        permissions: [...operator.permissions, permission, 'quotes.manage'],
        allowedSurfaces: ['MOBILE'],
      })
      .expect(200);
    const session = await http()
      .post('/api/v1/identity/login')
      .send({ email: operator.email, password, client: 'MOBILE' })
      .expect(200);
    operator.token = data<{ accessToken: string }>(session).accessToken;
    await auth(
      http().patch(`/api/v1/quotes/${principal.quote}/mobile-access`),
      operator.token,
    )
      .send({ mobileVisible: true })
      .expect(403);
    const result = await auth(
      http().get('/api/v1/mobile/field/documents?type=QUOTE'),
      operator.token,
    ).expect(200);
    expect(data<{ data: unknown[] }>(result).data).toEqual([]);
    await auth(
      http().get(`/api/v1/mobile/field/quotes/${principal.quote}/document`),
      operator.token,
    ).expect(404);
  });
  it('todos os estados comerciais são listados para o owner, inclusive rascunhos sem PDF emitido', async () => {
    const source = await admin.quote.findUniqueOrThrow({
      where: { id: principal.quote },
    });
    for (const [index, status] of [
      'SENT',
      'APPROVED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
    ].entries()) {
      await admin.quote.create({
        data: {
          organizationId: source.organizationId,
          businessUnitId: source.businessUnitId,
          customerId: source.customerId,
          number: 100 + index,
          code: `STATUS-${status}`,
          title: `Proposta ${status}`,
          status,
          createdById: source.createdById,
          sentAt: new Date(),
          decidedAt: new Date(),
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
        },
      });
    }
    const response = await auth(
      http().get('/api/v1/mobile/field/documents?type=QUOTE'),
    ).expect(200);
    const docs = data<{ data: { status: string; statusLabel: string }[] }>(
      response,
    ).data;
    expect(docs.map((doc) => doc.status).sort()).toEqual(
      ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'].sort(),
    );
    expect(docs.every((doc) => !!doc.statusLabel)).toBe(true);
  });
  it('operador cadastra equipamento no cliente correto e não troca de tenant ou unidade', async () => {
    const create = (customer: string, body: Record<string, unknown>) =>
      auth(
        http().post(
          `/api/v1/mobile/field/quotes/customers/${customer}/equipment`,
        ),
        operator.token,
      ).send(body);
    const body = {
      businessUnitId: principal.unit,
      name: 'Split registrado no orçamento',
      category: 'EQUIPMENT',
      identifierType: 'INTERNAL_CODE',
      manufacturer: 'Marca teste',
      location: 'Sala 2',
    };
    const created = await create(principal.customer, body).expect(201);
    expect(
      data<{ customerId: string; businessUnitId: string }>(created),
    ).toMatchObject({
      customerId: principal.customer,
      businessUnitId: principal.unit,
    });
    const options = await auth(
      http().get(
        `/api/v1/mobile/field/quotes/customers/${principal.customer}/options`,
      ),
      operator.token,
    ).expect(200);
    expect(
      data<{ equipment: { id: string }[] }>(options).equipment.map((e) => e.id),
    ).toContain(data<{ id: string }>(created).id);
    await create(neighbor.customer, body).expect(400);
    await create(principal.customer, {
      ...body,
      businessUnitId: neighbor.unit,
    }).expect(403);
    await create(principal.customer, {
      ...body,
      customerId: neighbor.customer,
    }).expect(400);
  });
});
