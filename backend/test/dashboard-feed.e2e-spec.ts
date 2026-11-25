import { paidSubscriptionFixture } from './support/paid-subscription-fixture';
import { registerVerifiedOwner } from './support/verified-owner-fixture';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * As duas listas do Dashboard — atividades recentes e próximos compromissos.
 *
 * Contra o PostgreSQL real com o papel de runtime: as datas vêm das próprias
 * tabelas, a RLS limita à organização e cada lista vem na ordem certa.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(180_000);

const PASSWORD = 'Orbit#Painel@2026';
const HOUR = 3_600_000;

describe('Dashboard: atividades e próximos compromissos (e2e)', () => {
  const prisma = adminPrisma();
  let app: INestApplication<App>;
  let token: string;
  let otherToken: string;
  let unitId: string;
  let customerId: string;

  const api = () => request(app.getHttpServer());
  const as = (test: request.Test, value = token) =>
    test.set('Authorization', `Bearer ${value}`);

  async function register(label: string) {
    const suffix = randomUUID().slice(0, 8);
    const email = `painel.${label}.${suffix}@orbit.local`;
    const registration = await registerVerifiedOwner(app, {
      ...REGISTRATION_LEGAL_ACCEPTANCE,
      email,
      firstName: 'Painel',
      lastName: label,
      password: PASSWORD,
      organizationName: `Painel ${label} ${suffix}`,
      legalName: `Painel ${label} ${suffix} LTDA`,
      documentType: 'CNPJ',
      documentNumber: cnpj(),
      city: 'Recife',
      street: 'Rua do Painel',
      stateCode: 'PE',
      planKey: 'ENTERPRISE_UNLIMITED',
    });
    await paidSubscriptionFixture(app, prisma, email);
    return registration.body.data.accessToken as string;
  }

  async function operation(title: string) {
    const created = await as(api().post('/api/v1/operations'))
      .send({
        businessUnitId: unitId,
        customerId,
        code: `OS-${randomUUID().slice(0, 8)}`.toUpperCase(),
        kind: 'MAINTENANCE',
        title,
      })
      .expect(201);
    return created.body.data.id as string;
  }

  beforeAll(async () => {
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

    token = await register('principal');
    otherToken = await register('vizinha');
    const organization = await as(
      api().get('/api/v1/organizations/current'),
    ).expect(200);
    unitId = organization.body.data.businessUnits[0].id;
    customerId = (
      await as(api().post('/api/v1/customers'))
        .send({ type: 'COMPANY', legalName: 'Clínica Painel LTDA' })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('as atividades vêm das datas reais, da mais recente para trás', async () => {
    const aberta = await operation('Preventiva aberta');
    const concluida = await operation('Corretiva concluída');
    await prisma.operation.update({
      where: { id: concluida },
      data: {
        status: 'COMPLETED',
        startedAt: new Date(Date.now() - 2 * HOUR),
        completedAt: new Date(Date.now() - HOUR),
      },
    });

    const response = await as(api().get('/api/v1/dashboard/activity')).expect(
      200,
    );
    const items: any[] = response.body.data.items;
    const eventos = items.map((item) => `${item.entityId}:${item.event}`);
    expect(eventos).toEqual(
      expect.arrayContaining([
        `${aberta}:CREATED`,
        `${concluida}:CREATED`,
        `${concluida}:STARTED`,
        `${concluida}:COMPLETED`,
      ]),
    );
    const concluido = items.find(
      (item) => item.entityId === concluida && item.event === 'COMPLETED',
    );
    expect(concluido).toMatchObject({
      kind: 'OPERATION',
      entityType: 'operation',
      title: 'Corretiva concluída',
      customerName: 'Clínica Painel LTDA',
    });
    const instantes = items.map((item) => Date.parse(item.at));
    expect([...instantes].sort((a, b) => b - a)).toEqual(instantes);
  });

  it('os próximos compromissos trazem só o que está à frente, em ordem', async () => {
    const amanha = await operation('Instalação amanhã');
    const semana = await operation('Higienização na semana');
    const passado = await operation('Visita de ontem');
    const longe = await operation('Daqui a dois meses');
    const at = (offsetHours: number) =>
      new Date(Date.now() + offsetHours * HOUR);
    await prisma.operation.update({
      where: { id: amanha },
      data: { scheduledStart: at(24), scheduledEnd: at(26) },
    });
    await prisma.operation.update({
      where: { id: semana },
      data: { scheduledStart: at(24 * 5), scheduledEnd: at(24 * 5 + 2) },
    });
    await prisma.operation.update({
      where: { id: passado },
      data: { scheduledStart: at(-24), scheduledEnd: at(-22) },
    });
    await prisma.operation.update({
      where: { id: longe },
      data: { scheduledStart: at(24 * 60), scheduledEnd: at(24 * 60 + 2) },
    });

    const response = await as(api().get('/api/v1/dashboard/upcoming')).expect(
      200,
    );
    const ids = response.body.data.items.map((item: any) => item.entityId);
    expect(ids).toEqual([amanha, semana]);
    expect(response.body.data.items[0]).toMatchObject({
      kind: 'OPERATION',
      event: 'SCHEDULED',
      title: 'Instalação amanhã',
    });

    /* Com uma janela maior, o que está a dois meses entra. */
    const largo = await as(
      api().get('/api/v1/dashboard/upcoming?days=60'),
    ).expect(200);
    expect(largo.body.data.items.map((item: any) => item.entityId)).toContain(
      longe,
    );
  });

  it('cada organização só vê o que é seu, e os filtros são validados', async () => {
    const vizinha = await as(
      api().get('/api/v1/dashboard/activity'),
      otherToken,
    ).expect(200);
    expect(vizinha.body.data.items).toEqual([]);
    await as(api().get('/api/v1/dashboard/upcoming?days=999')).expect(400);
    await as(api().get('/api/v1/dashboard/activity?limit=0')).expect(400);
  });
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
    return rest < 2 ? `${0}` : `${11 - rest}`;
  };
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}
