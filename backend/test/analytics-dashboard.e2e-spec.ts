import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  RequestContext,
  RequestContextService,
  RequestContextStorage,
} from '../src/context';
import type { UUID } from '../src/contracts';
import { PrismaService, RlsTransaction } from '../src/database';
import { RlsContextProvider } from '../src/database/rls/rls-context.provider';
import { AnalyticsRepository } from '../src/modules/analytics/analytics.repository';
import type { AnalyticsRange } from '../src/modules/analytics/analytics.types';
import { analyticsAccess } from '../src/modules/analytics/analytics-authorization';
import {
  instantFromCivil,
  instantFromCivilDate,
} from '../src/modules/scheduling/scheduling-time';
import { KpiEngine } from '../src/modules/analytics/engines/kpi.engine';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

/** Real queries and RLS; never read production configuration or seed customer data. */
describe('dashboard facts with tenant and business-unit isolation', () => {
  const admin = adminPrisma();
  const contexts = new RequestContextStorage();
  const suffix = randomUUID();
  const range: AnalyticsRange = {
    from: new Date('2026-11-01T03:00:00Z'),
    to: new Date('2026-11-10T15:00:00Z'),
    previousFrom: new Date('2026-10-22T15:00:00Z'),
    previousTo: new Date('2026-11-01T02:59:59Z'),
    granularity: 'DAY',
  };
  const tenants: {
    organizationId: string;
    unitId: string;
    customerId: string;
  }[] = [];
  let runtime: PrismaClient<Prisma.PrismaClientOptions, 'query'>;
  const queries: string[] = [];
  let repository: AnalyticsRepository;
  let rls: RlsTransaction;
  let userId: string;
  let otherUnitId: string;
  const run = <T>(work: () => Promise<T>) =>
    contexts.run(
      new RequestContext({
        requestId: randomUUID(),
        actorType: 'INTERNAL_USER',
        userId: userId as UUID,
        organizationId: tenants[0]!.organizationId as UUID,
        businessUnitId: tenants[0]!.unitId as UUID,
        businessUnitIds: [tenants[0]!.unitId as UUID, otherUnitId as UUID],
        roles: ['ORGANIZATION_OWNER'],
        permissions: ['*'],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      work,
    );
  const snapshot = (permissions = ['*'], unitId = tenants[0]!.unitId) =>
    run(() =>
      repository.snapshot(
        tenants[0]!.organizationId,
        { ...range, businessUnitId: unitId },
        analyticsAccess(permissions).domains,
      ),
    );

  beforeAll(async () => {
    if (!process.env.APP_DATABASE_URL)
      throw new Error('APP_DATABASE_URL restrita é obrigatória.');
    runtime = new PrismaClient({
      adapter: new PrismaPg(process.env.APP_DATABASE_URL),
      log: [{ emit: 'event', level: 'query' }],
    });
    runtime.$on('query', ({ query }) => queries.push(query));
    const [role] = await runtime.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    userId = (
      await admin.user.create({
        data: {
          email: `analytics.${suffix}@orbit.local`,
          normalizedEmail: `analytics.${suffix}@orbit.local`,
          firstName: 'Teste',
          lastName: 'Dashboard',
          displayName: 'Teste Dashboard',
          status: 'ACTIVE',
        },
      })
    ).id;
    const plan = await admin.plan.upsert({
      where: { key: 'ANALYTICS_TEST' },
      update: {},
      create: { key: 'ANALYTICS_TEST', name: 'Teste isolado' },
    });
    for (const name of ['local', 'foreign']) {
      const org = await admin.organization.create({
        data: {
          ownerUserId: userId,
          planId: plan.id,
          slug: `analytics-${name}-${suffix}`,
          displayName: name,
          primarySegment: 'HVAC',
        },
      });
      const unit = await admin.businessUnit.create({
        data: {
          organizationId: org.id,
          slug: 'matriz',
          legalName: 'Matriz',
          documentType: 'CNPJ',
          documentNumber: '12345678000195',
          street: 'Rua de teste',
          city: 'Recife',
          timezone: 'America/Recife',
        },
      });
      const customer = await admin.customer.create({
        data: { organizationId: org.id, legalName: `Cliente ${name}` },
      });
      tenants.push({
        organizationId: org.id,
        unitId: unit.id,
        customerId: customer.id,
      });
    }
    otherUnitId = (
      await admin.businessUnit.create({
        data: {
          organizationId: tenants[0]!.organizationId,
          slug: 'filial',
          legalName: 'Filial',
          documentType: 'CNPJ',
          documentNumber: '12345678000195',
          street: 'Rua de teste',
          city: 'Recife',
        },
      })
    ).id;
    rls = new RlsTransaction(
      runtime as PrismaService,
      new RlsContextProvider(new RequestContextService(contexts)),
    );
    repository = new AnalyticsRepository(rls);
    let code = 0;
    const operation = (tenant = tenants[0]!, overrides = {}) =>
      admin.operation.create({
        data: {
          organizationId: tenant.organizationId,
          businessUnitId: tenant.unitId,
          code: `OS-${++code}`,
          kind: 'MAINTENANCE',
          title: 'Manutenção',
          createdAt: new Date('2026-01-01'),
          ...overrides,
        },
      });
    await operation(tenants[0], { scheduledEnd: new Date('2026-10-01') });
    await operation(tenants[0], {
      status: 'COMPLETED',
      completedAt: new Date('2026-11-05T13:00:00Z'),
      scheduledEnd: new Date('2026-11-05T14:00:00Z'),
    });
    await operation(tenants[0], {
      status: 'CANCELLED',
      createdAt: new Date('2026-11-02'),
    });
    await operation(tenants[0], { businessUnitId: otherUnitId });
    await operation(tenants[1]);
    for (const tenant of [
      tenants[0]!,
      { ...tenants[0]!, unitId: otherUnitId },
      tenants[1]!,
    ]) {
      const asset = await admin.asset.create({
        data: {
          organizationId: tenant.organizationId,
          businessUnitId: tenant.unitId,
          customerId: tenant.customerId,
          name: 'Equipamento de teste',
          category: 'HVAC',
        },
      });
      const pmoc = await admin.pmocPlan.create({
        data: {
          organizationId: tenant.organizationId,
          businessUnitId: tenant.unitId,
          customerId: tenant.customerId,
          code: `PMOC-${++code}`,
          name: 'Manutenção',
          status: 'ACTIVE',
          startsOn: new Date('2026-01-01'),
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          createdById: userId,
          coverages: {
            create: {
              organizationId: tenant.organizationId,
              assetId: asset.id,
              startsOn: new Date('2026-01-01'),
            },
          },
        },
      });
      for (const [i, due] of [
        '2026-10-01',
        '2026-11-10',
        '2026-12-10',
      ].entries())
        await admin.pmocExecution.create({
          data: {
            organizationId: tenant.organizationId,
            planId: pmoc.id,
            dueOn: new Date(due),
            sequenceNumber: i + 1,
          },
        });
      const rvt = await admin.rvtConfiguration.create({
        data: {
          organizationId: tenant.organizationId,
          businessUnitId: tenant.unitId,
          customerId: tenant.customerId,
          code: `RVT-${++code}`,
          name: 'Visitas',
          scheduleMode: 'ONE_TIME',
          coverageStart: new Date('2026-01-01'),
          timezone: 'America/Recife',
          serviceLocation: {},
          createdById: userId,
        },
      });
      for (const [i, scheduled] of [
        '2026-10-01T12:00:00Z',
        '2026-11-10T13:00:00Z',
        '2026-11-10T16:00:00Z',
        '2026-12-10T12:00:00Z',
      ].entries())
        await admin.rvtOccurrence.create({
          data: {
            organizationId: tenant.organizationId,
            businessUnitId: tenant.unitId,
            configurationId: rvt.id,
            sequenceNumber: i + 1,
            scheduledFor: new Date(scheduled),
          },
        });
    }
  }, 30000);
  afterAll(async () => {
    await runtime?.$disconnect();
    for (const tenant of tenants) {
      await admin.rvtOccurrence.deleteMany({
        where: { organizationId: tenant.organizationId },
      });
      await admin.rvtConfiguration.deleteMany({
        where: { organizationId: tenant.organizationId },
      });
    }
    await admin.organization.deleteMany({
      where: { id: { in: tenants.map((tenant) => tenant.organizationId) } },
    });
    if (userId) await admin.user.delete({ where: { id: userId } });
    await disconnectAdminPrisma();
  });

  it('includes old pending work and old orders delivered now, without mixing units or organizations', async () => {
    const facts = await snapshot();
    expect(facts.trends.completed).toEqual([
      { timestamp: '2026-11-05T00:00:00.000Z', value: 1 },
    ]);
    expect(facts.trends.created).toEqual([]);
    const metrics = new KpiEngine().execute(facts).indicators;
    const value = (id: string) => metrics.find((item) => item.id === id)?.value;
    expect(value('operations.open')).toBe(1);
    expect(value('operations.overdue')).toBe(1);
    expect(value('operations.completed')).toBe(1);
    expect(value('operations.sla_compliance')).toBe(100);
    expect(value('operations.total')).toBe(0);
  });
  it('evaluates PMOC and RVT fulfillment through the end of their local due day', async () => {
    const facts = await snapshot();
    const metrics = new KpiEngine().execute(facts).indicators;
    expect(metrics.find((item) => item.id === 'pmoc.overdue')?.value).toBe(1);
    expect(metrics.find((item) => item.id === 'rvt.overdue')?.value).toBe(1);
    expect(facts.pmoc.current).toEqual({ total: 1, overdue: 1, onTime: 0 });
    expect(facts.rvt.current).toEqual({ total: 1, overdue: 1, onTime: 0 });
    expect(facts.trends.pmoc).toEqual([
      { timestamp: '2026-11-10T00:00:00.000Z', value: 1 },
    ]);
    const endOfDueDay = await run(() =>
      repository.snapshot(
        tenants[0]!.organizationId,
        {
          ...range,
          businessUnitId: tenants[0]!.unitId,
          to: new Date('2026-11-11T02:59:59.999Z'),
        },
        analyticsAccess(['*']).domains,
      ),
    );
    expect(endOfDueDay.pmoc.current.total).toBe(2);
    expect(endOfDueDay.rvt.current.total).toBe(3);
  });
  it('keeps domain-denied maintenance out of database facts', async () => {
    queries.length = 0;
    const facts = await snapshot(['operations.read']);
    expect(facts.operations.open).toBe(1);
    expect(facts.pmoc.current.total).toBe(0);
    expect(facts.rvt.current.total).toBe(0);
    expect(facts.equipmentRegistered).toBe(0);
    expect(queries.join(' ')).not.toMatch(
      /pmoc_executions|rvt_occurrences|FROM "public"."assets"/i,
    );
  });
  it('switches business units without retaining their backlog or equipment', async () => {
    const facts = await snapshot(['*'], otherUnitId);
    expect(facts.operations.open).toBe(1);
    expect(facts.operations.current.delivered).toBe(0);
    expect(facts.operations.overdue).toBe(0);
    expect(facts.equipmentRegistered).toBe(1);
  });
  it('resolves civil times the same way as scheduling across timezone folds and gaps', async () => {
    for (const [day, zone, hour] of [
      ['2018-11-04', 'America/Sao_Paulo', 0],
      ['2026-03-08', 'America/New_York', 2],
      ['2026-11-01', 'America/New_York', 1],
      ['2026-11-10', 'Pacific/Kiritimati', 0],
      ['2026-11-10', 'Asia/Kathmandu', 0],
    ] as const) {
      const [row] = await runtime.$queryRaw<{ instant: Date }[]>`
        SELECT orbit_analytics_civil_instant(${day}::date + make_interval(hours => ${hour}::int), ${zone}) AS instant
      `;
      const [year, month, date] = day.split('-').map(Number);
      const expected =
        hour === 0
          ? instantFromCivilDate(day, zone)
          : instantFromCivil(
              { year: year!, month: month!, day: date!, hour },
              zone,
            );
      expect(row?.instant).toEqual(expected);
    }
  });

  it('enforces organization isolation in the database beyond repository filters', async () => {
    const foreign = tenants[1]!.organizationId;
    await run(async () => {
      expect(
        await rls.run((tx) =>
          tx.operation.count({ where: { organizationId: foreign } }),
        ),
      ).toBe(0);
      expect(
        await rls.run((tx) =>
          tx.pmocExecution.count({ where: { organizationId: foreign } }),
        ),
      ).toBe(0);
      expect(
        await rls.run((tx) =>
          tx.rvtOccurrence.count({ where: { organizationId: foreign } }),
        ),
      ).toBe(0);
    });
  });
});
