import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { RlsTransaction } from '../src/database';
import { MobileFieldRepository } from '../src/modules/mobile-field/mobile-field.repository';
import { RecurringAuthorizationService } from '../src/modules/operations/recurring-authorization.service';
import { RecurringAuthorizationQueryDto } from '../src/modules/operations/dto/recurring-authorization.dto';
import { ConflictException, EntityNotFoundException } from '../src/exceptions';

describe('autorização de demandas recorrentes com RLS real', () => {
  const admin = adminPrisma();
  let runtime: PrismaClient;
  let service: RecurringAuthorizationService;
  let field: MobileFieldRepository;
  let actor: { id: string; organizationId: string; businessUnitIds: string[] };
  const organizations: string[] = [];
  let userId: string;
  let visitId: string;
  let cycleId: string;
  let foreignVisitId: string;

  beforeAll(async () => {
    if (!process.env.APP_DATABASE_URL)
      throw new Error('APP_DATABASE_URL restrita é obrigatória neste teste.');
    runtime = new PrismaClient({
      adapter: new PrismaPg(process.env.APP_DATABASE_URL),
    });
    const [privileges] = await runtime.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(privileges).toEqual({ rolsuper: false, rolbypassrls: false });
    const suffix = randomUUID();
    const user = await admin.user.create({
      data: {
        email: `auto.recurring.${suffix}@orbit.local`,
        normalizedEmail: `auto.recurring.${suffix}@orbit.local`,
        firstName: 'Técnico',
        lastName: 'Teste',
        displayName: 'Técnico Teste',
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
          slug: `${label}-${suffix}`,
          displayName: label,
          primarySegment: 'HVAC',
          settings: { operations: { requireAssignmentAuthorization: true } },
        },
      });
      organizations.push(organization.id);
      const unit = await admin.businessUnit.create({
        data: {
          organizationId: organization.id,
          slug: 'matriz',
          legalName: 'Matriz',
          documentType: 'CNPJ',
          documentNumber: '12345678000195',
          city: 'Recife',
          street: 'Rua de teste',
        },
      });
      const customer = await admin.customer.create({
        data: { organizationId: organization.id, legalName: 'Cliente Teste' },
      });
      await admin.professionalProfile.create({
        data: {
          organizationId: organization.id,
          userId,
          fieldTechnicianEnabled: true,
        },
      });
      const configuration = await admin.rvtConfiguration.create({
        data: {
          organizationId: organization.id,
          businessUnitId: unit.id,
          customerId: customer.id,
          code: 'RVT-1',
          name: 'Visita mensal',
          scheduleMode: 'ONE_TIME',
          coverageStart: new Date('2026-10-28'),
          timezone: 'America/Recife',
          serviceLocation: {},
          createdById: userId,
        },
      });
      const visit = await admin.rvtOccurrence.create({
        data: {
          organizationId: organization.id,
          businessUnitId: unit.id,
          configurationId: configuration.id,
          sequenceNumber: 1,
          responsibleFieldTechnicianId: userId,
          scheduledFor: new Date('2026-10-29T12:00:00Z'),
        },
      });
      const pmoc = await admin.pmocPlan.create({
        data: {
          organizationId: organization.id,
          businessUnitId: unit.id,
          customerId: customer.id,
          code: 'PMOC-1',
          name: 'Manutenção mensal',
          startsOn: new Date('2026-10-28'),
          frequencyAmount: 1,
          frequencyUnit: 'MONTHS',
          technicianUserId: userId,
          status: 'DRAFT',
          createdById: userId,
        },
      });
      const asset = await admin.asset.create({
        data: {
          organizationId: organization.id,
          businessUnitId: unit.id,
          customerId: customer.id,
          name: 'Split de teste',
          category: 'EQUIPMENT',
        },
      });
      await admin.pmocEquipmentCoverage.create({
        data: {
          organizationId: organization.id,
          planId: pmoc.id,
          assetId: asset.id,
          startsOn: new Date('2026-10-28'),
        },
      });
      await admin.pmocPlan.update({
        where: { id: pmoc.id },
        data: { status: 'ACTIVE' },
      });
      const cycle = await admin.pmocExecution.create({
        data: {
          organizationId: organization.id,
          planId: pmoc.id,
          dueOn: new Date('2026-10-30'),
        },
      });
      if (label === 'local') {
        actor = {
          id: userId,
          organizationId: organization.id,
          businessUnitIds: [unit.id],
        };
        visitId = visit.id;
        cycleId = cycle.id;
      } else foreignVisitId = visit.id;
    }
    const rls = new RlsTransaction(
      runtime as never,
      {
        get: () => ({
          actorType: 'USER',
          userId,
          portalIdentityId: '',
          organizationId: actor.organizationId,
          customerId: '',
          businessUnitId: '',
          businessUnitIds: actor.businessUnitIds.join(','),
          roles: 'FIELD_TECHNICIAN',
          permissions: 'operations.read,rvt.read,pmoc.read,operations.assign',
          isPlatformAdmin: 'false',
        }),
      } as never,
    );
    service = new RecurringAuthorizationService(rls);
    field = new MobileFieldRepository(rls);
  });

  afterAll(async () => {
    if (runtime) await runtime.$disconnect();
    await admin.rvtConfiguration.deleteMany({
      where: { organizationId: { in: organizations } },
    });
    await admin.organization.deleteMany({
      where: { id: { in: organizations } },
    });
    if (userId) await admin.user.delete({ where: { id: userId } });
    await disconnectAdminPrisma();
  });

  const projection = () =>
    field.project(actor.organizationId, actor.id, actor.businessUnitIds);

  it('lista RVT e PMOC para revisão e oculta as duas demandas na projeção do aplicativo', async () => {
    const pending = await service.list(
      actor,
      new RecurringAuthorizationQueryDto(),
    );
    expect(pending.data.map((item) => item.id).sort()).toEqual(
      [visitId, cycleId].sort(),
    );
    const before = await projection();
    expect(before.rvtOccurrences).toEqual([]);
    expect(before.pmocCycles).toEqual([]);
  });

  it('desfaz todo o lote se uma demanda mudou desde a revisão', async () => {
    const pending = await service.list(
      actor,
      new RecurringAuthorizationQueryDto(),
    );
    const targets = pending.data.map(({ id, kind, version }) => ({
      id,
      kind,
      version,
    }));
    await admin.pmocExecution.update({
      where: { id: cycleId },
      data: { updatedAt: new Date(Date.now() + 1000) },
    });
    await expect(service.authorize(actor, targets)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      (await admin.rvtOccurrence.findUniqueOrThrow({ where: { id: visitId } }))
        .authorizedAt,
    ).toBeNull();
    expect(
      await admin.auditLog.count({
        where: {
          organizationId: actor.organizationId,
          action: 'ASSIGNMENT_AUTHORIZED',
        },
      }),
    ).toBe(0);
  });

  it('recusa ids de outra organização mesmo quando pertencem ao mesmo técnico', async () => {
    await expect(
      service.authorize(actor, [
        { kind: 'RVT', id: foreignVisitId, version: new Date().toISOString() },
      ]),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(
      (
        await admin.rvtOccurrence.findUniqueOrThrow({
          where: { id: foreignVisitId },
        })
      ).authorizedAt,
    ).toBeNull();
  });

  it('aprovação libera somente as demandas revisadas e autorizadas', async () => {
    const pending = await service.list(
      actor,
      new RecurringAuthorizationQueryDto(),
    );
    await expect(
      service.authorize(
        actor,
        pending.data.map(({ id, kind, version }) => ({ id, kind, version })),
      ),
    ).resolves.toEqual({ authorized: 2 });
    expect(
      (await service.list(actor, new RecurringAuthorizationQueryDto())).data,
    ).toEqual([]);
    const after = await projection();
    expect(after.rvtOccurrences.map((item: { id: string }) => item.id)).toEqual(
      [visitId],
    );
    expect(after.pmocCycles.map((item: { id: string }) => item.id)).toEqual([
      cycleId,
    ]);
  });

  it('com a exigência desligada, as demandas atribuídas permanecem acessíveis sem carimbo', async () => {
    await admin.organization.update({
      where: { id: actor.organizationId },
      data: { settings: {} },
    });
    await admin.rvtOccurrence.update({
      where: { id: visitId },
      data: { authorizedAt: null },
    });
    await admin.pmocExecution.update({
      where: { id: cycleId },
      data: { authorizedAt: null },
    });
    const result = await projection();
    expect(
      result.rvtOccurrences.map((item: { id: string }) => item.id),
    ).toEqual([visitId]);
    expect(result.pmocCycles.map((item: { id: string }) => item.id)).toEqual([
      cycleId,
    ]);
  });
});
