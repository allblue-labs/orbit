import { brandImageStub } from '../../../test/support/brand-image.stub';
/* Jest asymmetric matchers are intentionally used in expected objects. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PmocRepository } from './pmoc.repository';
import { PmocService, type PmocActor } from './pmoc.service';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';

const stamp = new Date('2026-11-10T12:00:00Z');
const actor: PmocActor = {
  actorId: 'owner',
  organizationId: 'org',
  businessUnitIds: ['unit'],
  permissions: ['*'],
  isOrganizationOwner: true,
};
const input = {
  organizationId: 'org',
  businessUnitId: 'unit',
  planId: 'plan',
  cycleId: 'cycle',
  coverageId: 'coverage',
  actorId: 'owner',
  expectedVersion: 'unplanned',
  responsibleFieldTechnicianId: 'field',
  auxiliaryTechnicianIds: ['assistant'],
  scheduledFor: stamp,
  notes: 'Conferir filtro',
};

function repositoryFixture() {
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ next_due_on: new Date('2026-12-10') }]),
    pmocExecution: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'cycle', status: 'PENDING', dueOn: stamp }),
      findFirstOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'cycle', status: 'PENDING', dueOn: stamp }),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pmocEquipmentCoverage: {
      findFirst: jest.fn().mockResolvedValue({ id: 'coverage' }),
      count: jest.fn().mockResolvedValue(2),
    },
    pmocEquipmentExecution: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    pmocEquipmentSchedule: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'schedule' }),
    },
    operation: { update: jest.fn() },
    operationHistory: { create: jest.fn() },
    operationUser: { deleteMany: jest.fn(), create: jest.fn() },
    operationAuxiliaryTechnician: {
      updateMany: jest.fn(),
      createMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  };
  const repository = new PmocRepository(
    { run: (fn: (value: unknown) => unknown) => fn(tx) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { tx, repository };
}

describe('gerenciamento de execução PMOC por equipamento', () => {
  it('atribui e agenda sem criar uma execução ou iniciar uma operação', async () => {
    const { repository, tx } = repositoryFixture();
    await repository.manageEquipmentSchedule(input);
    expect(tx.pmocEquipmentSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: 'org',
          businessUnitId: 'unit',
          cycleId: 'cycle',
          coverageId: 'coverage',
          responsibleFieldTechnicianId: 'field',
          auxiliaryTechnicianIds: ['assistant'],
          scheduledFor: stamp,
        }),
      }),
    );
    expect(tx.pmocEquipmentExecution.update).not.toHaveBeenCalled();
    expect(tx.operation.update).not.toHaveBeenCalled();
    expect(tx.pmocExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { updatedAt: expect.any(Date) } }),
    );
  });
  it('sincroniza a substituição da equipe na execução e na operação vinculada', async () => {
    const { repository, tx } = repositoryFixture();
    tx.pmocEquipmentExecution.findUnique.mockResolvedValue({
      id: 'physical',
      status: 'IN_PROGRESS',
      operationId: 'operation',
      updatedAt: stamp,
    });
    await repository.manageEquipmentSchedule({
      ...input,
      expectedVersion: stamp.toISOString(),
    });
    expect(tx.pmocEquipmentExecution.update).toHaveBeenCalledWith({
      where: { id: 'physical' },
      data: { responsibleFieldTechnicianId: 'field', notes: input.notes },
    });
    expect(tx.operationUser.deleteMany).toHaveBeenCalledWith({
      where: { operationId: 'operation' },
    });
    expect(tx.operationUser.create).toHaveBeenCalledWith({
      data: {
        operationId: 'operation',
        userId: 'field',
        assignedById: 'owner',
      },
    });
    expect(tx.operationAuxiliaryTechnician.updateMany).toHaveBeenCalled();
    expect(tx.operationAuxiliaryTechnician.createMany).toHaveBeenCalled();
  });
  it.each(['COMPLETED', 'CANCELLED'])(
    'não altera equipamento encerrado (%s)',
    async (status) => {
      const { repository, tx } = repositoryFixture();
      tx.pmocEquipmentExecution.findUnique.mockResolvedValue({
        status,
        updatedAt: stamp,
      });
      await expect(
        repository.manageEquipmentSchedule(input),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.pmocEquipmentSchedule.upsert).not.toHaveBeenCalled();
    },
  );
  it('recusa uma versão antiga, sem sobrescrever a atribuição atual', async () => {
    const { repository, tx } = repositoryFixture();
    tx.pmocEquipmentSchedule.findUnique.mockResolvedValue({ updatedAt: stamp });
    await expect(repository.manageEquipmentSchedule(input)).rejects.toThrow(
      /foi alterada/i,
    );
    expect(tx.pmocEquipmentSchedule.upsert).not.toHaveBeenCalled();
  });
  it('não permite atravessar organização, plano ou unidade', async () => {
    const { repository, tx } = repositoryFixture();
    tx.pmocExecution.findFirst.mockResolvedValue(null);
    await expect(
      repository.manageEquipmentSchedule(input),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(tx.pmocExecution.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org',
          planId: 'plan',
          plan: expect.objectContaining({ businessUnitId: 'unit' }),
        }),
      }),
    );
    expect(tx.pmocEquipmentSchedule.upsert).not.toHaveBeenCalled();
  });
  it('cancela somente o equipamento escolhido e guarda o motivo, sem apagar registros', async () => {
    const { repository, tx } = repositoryFixture();
    tx.pmocEquipmentCoverage.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    await repository.manageEquipmentSchedule({
      ...input,
      cancellationReason: 'Cliente indisponível',
    });
    expect(tx.pmocEquipmentSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          cancelledAt: expect.any(Date),
          cancellationReason: 'Cliente indisponível',
        }),
      }),
    );
    expect(tx.pmocExecution.updateMany).not.toHaveBeenCalled();
    expect(tx.pmocEquipmentExecution.update).not.toHaveBeenCalled();
  });
  it('encerramento por cancelamento não inventa manutenção realizada e mantém a próxima previsão', async () => {
    const { repository, tx } = repositoryFixture();
    await repository.manageEquipmentSchedule({
      ...input,
      cancellationReason: 'Cliente indisponível',
    });
    expect(tx.pmocExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'CANCELLED',
          performedAt: null,
          completedById: 'owner',
        },
      }),
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3); // two row locks and next pending cycle
  });
});

function serviceFixture(required = false, authorized = false) {
  const data = {
    plan: { id: 'plan', businessUnitId: 'unit', technicianUserId: null },
    cycle: { id: 'cycle', authorizedAt: authorized ? stamp : null },
    coverage: { id: 'coverage' },
    existing: null,
    schedule: null,
    assignmentAuthorizationRequired: required,
  };
  const repository = {
    executionPreparation: jest.fn().mockResolvedValue(data),
    manageEquipmentSchedule: jest.fn().mockResolvedValue({ id: 'schedule' }),
  };
  const workforce = {
    listPmocFieldTechnicians: jest.fn().mockResolvedValue([{ id: 'field' }]),
    listFieldAssistantCandidates: jest
      .fn()
      .mockResolvedValue([{ id: 'assistant' }]),
  };
  const notifications = { materialize: jest.fn() };
  const service = new PmocService(
    repository as never,
    {} as never,
    {} as never,
    workforce as never,
    {} as never,
    {} as never,
    {} as never,
    notifications as never,
    brandImageStub(),
  );
  return { service, repository, notifications, data };
}

describe('autoridade e liberação da atribuição PMOC', () => {
  const update = {
    expectedVersion: 'unplanned',
    responsibleFieldTechnicianId: 'field',
    auxiliaryTechnicianIds: ['assistant'],
  };
  it('exige gestão para atribuir e cancelar, mesmo sendo o técnico previsto', async () => {
    const { service, repository } = serviceFixture();
    const field = {
      ...actor,
      actorId: 'field',
      isOrganizationOwner: false,
      permissions: ['pmoc.execute'],
    };
    await expect(
      service.manageEquipmentSchedule('plan', 'cycle', 'asset', field, update),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.manageEquipmentSchedule('plan', 'cycle', 'asset', field, {
        expectedVersion: 'unplanned',
        reason: 'Sem acesso',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.manageEquipmentSchedule).not.toHaveBeenCalled();
  });
  it('recusa técnicos e auxiliares de fora da unidade', async () => {
    const { service, repository } = serviceFixture();
    await expect(
      service.manageEquipmentSchedule('plan', 'cycle', 'asset', actor, {
        ...update,
        responsibleFieldTechnicianId: 'other',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
    await expect(
      service.manageEquipmentSchedule('plan', 'cycle', 'asset', actor, {
        ...update,
        auxiliaryTechnicianIds: ['other'],
      }),
    ).rejects.toBeInstanceOf(ValidationException);
    await expect(
      service.manageEquipmentSchedule(
        'plan',
        'cycle',
        'asset',
        { ...actor, businessUnitIds: ['other'] },
        update,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.manageEquipmentSchedule).not.toHaveBeenCalled();
  });
  it.each([
    [false, false, 1],
    [true, false, 0],
    [true, true, 1],
  ])(
    'atribui sem liberar indevidamente nem avisar antes da autorização (%s/%s)',
    async (required, authorized, count) => {
      const { service, repository, notifications } = serviceFixture(
        Boolean(required),
        Boolean(authorized),
      );
      await service.manageEquipmentSchedule(
        'plan',
        'cycle',
        'asset',
        actor,
        update,
      );
      expect(repository.manageEquipmentSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId: 'cycle',
          responsibleFieldTechnicianId: 'field',
        }),
      );
      expect(notifications.materialize).toHaveBeenCalledTimes(Number(count));
    },
  );
});
