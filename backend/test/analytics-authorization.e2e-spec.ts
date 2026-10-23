import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

const PASSWORD = 'Orbit#Analytics@2026';
function cnpj(): string {
  const base =
    `${Math.floor(Math.random() * 100_000_000)}`.padStart(8, '0') + '0001';
  const digit = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const remainder =
      value
        .split('')
        .reduce((sum, item, index) => sum + Number(item) * weights[index]!, 0) %
      11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = digit(base);
  return `${base}${first}${digit(`${base}${first}`)}`;
}

describe('Analytics compound authorization (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = adminPrisma();
  let email: string;
  let roleId: string;

  const http = () => request(app.getHttpServer());
  const auth = (path: string, token: string) =>
    http().get(path).set('authorization', `Bearer ${token}`);

  async function login() {
    const response = await http()
      .post('/api/v1/identity/login')
      .send({ email, password: PASSWORD, client: 'WEB' })
      .expect(200);
    return (response.body as { data: { accessToken: string } }).data
      .accessToken;
  }

  async function permissions(values: string[]) {
    await prisma.role.update({
      where: { id: roleId },
      data: { permissions: values },
    });
    return login();
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApiVersioning(app);
    await app.listen(0, '127.0.0.1');

    email = `analytics.${randomUUID()}@orbit.local`;
    const suffix = randomUUID().slice(0, 8);
    await http()
      .post('/api/v1/identity/register')
      .send({
        ...REGISTRATION_LEGAL_ACCEPTANCE,
        email,
        firstName: 'Analytics',
        lastName: 'Gate',
        password: PASSWORD,
        client: 'WEB',
        organizationName: `Analytics Gate ${suffix}`,
        legalName: `Analytics Gate ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: cnpj(),
        city: 'Recife',
        street: 'Rua do Sol',
        stateCode: 'PE',
        primarySegment: 'HVAC-R',
      })
      .expect(201);
    const user = await prisma.user.findFirstOrThrow({
      where: { email },
      select: {
        id: true,
        organizationMemberships: { select: { roleId: true } },
      },
    });
    roleId = user.organizationMemberships[0]!.roleId;
  }, 120000);

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('keeps Operations available without leaking PMOC', async () => {
    const token = await permissions([
      'analytics.read',
      'operations.read',
      'dashboard.read',
    ]);
    const response = await auth('/api/v1/analytics/kpis', token).expect(200);
    const data = (
      response.body as {
        data: {
          indicators: Array<{ domain: string }>;
          availability: Array<{ domain: string; available: boolean }>;
        };
      }
    ).data;
    expect(data.indicators.some((item) => item.domain === 'OPERATIONS')).toBe(
      true,
    );
    expect(data.indicators.some((item) => item.domain === 'PMOC')).toBe(false);
    expect(
      data.availability.find((item) => item.domain === 'PMOC'),
    ).toMatchObject({ available: false });

    const dashboard = await auth('/api/v1/dashboard', token).expect(200);
    const widgets = (
      dashboard.body as { data: { layout: { widgets: Array<{ id: string }> } } }
    ).data.layout.widgets;
    expect(widgets.some((item) => item.id === 'hvac-pmoc-status')).toBe(false);
  });

  it('keeps PMOC available without leaking Operations and enables its real widget', async () => {
    const token = await permissions([
      'analytics.read',
      'pmoc.read',
      'dashboard.read',
    ]);
    const response = await auth('/api/v1/analytics/kpis', token).expect(200);
    const data = (
      response.body as {
        data: {
          indicators: Array<{ domain: string }>;
          availability: Array<{ domain: string; available: boolean }>;
        };
      }
    ).data;
    expect(data.indicators.some((item) => item.domain === 'PMOC')).toBe(true);
    expect(data.indicators.some((item) => item.domain === 'OPERATIONS')).toBe(
      false,
    );
    expect(
      data.availability.find((item) => item.domain === 'OPERATIONS'),
    ).toMatchObject({ available: false });

    const dashboard = await auth('/api/v1/dashboard', token).expect(200);
    const widget = (
      dashboard.body as {
        data: {
          layout: {
            widgets: Array<{
              id: string;
              data: { metrics?: Array<{ key: string }> };
            }>;
          };
        };
      }
    ).data.layout.widgets.find((item) => item.id === 'hvac-pmoc-status');
    expect(widget?.data.metrics?.map((item) => item.key)).toEqual([
      'active',
      'attention',
      'compliance',
    ]);
  });

  it('requires analytics.read even when the domain capability exists', async () => {
    const token = await permissions(['operations.read']);
    await auth('/api/v1/analytics/kpis', token).expect(403);
  });
});
