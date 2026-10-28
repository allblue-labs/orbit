/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PmocRepository } from './pmoc.repository';
import {
  ConflictException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';

function fixture() {
  const execution = {
    id: 'execution-1',
    organizationId: 'org-1',
    businessUnitId: 'bu-1',
    status: 'IN_PROGRESS',
    responsibleFieldTechnicianId: 'tech-1',
    updatedAt: new Date('2026-10-27T12:00:00Z'),
    procedureSnapshot: { Evaporadora: ['Limpar filtro', 'Verificar dreno'] },
    operation: { id: 'operation-1', data: { preserved: 'value' } },
    cycle: { authorizedAt: null },
    plan: { procedure: {}, units: [] },
  };
  const tx = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ settings: null }),
    },
    pmocExecution: {
      findFirst: jest.fn().mockResolvedValue({ authorizedAt: null }),
    },
    $executeRaw: jest.fn(),
    pmocEquipmentExecution: {
      updateMany: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(execution),
      update: jest.fn(),
    },
    operation: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const repository = new PmocRepository(
    { run: (callback: (tx: unknown) => unknown) => callback(tx) } as never,
    { get: () => ({}) } as never,
    {} as never,
    {} as never,
  );
  const input = {
    organizationId: 'org-1',
    planId: 'plan-1',
    cycleId: 'cycle-1',
    executionId: execution.id,
    actorId: 'tech-1',
    isOwner: false,
    businessUnitIds: ['bu-1'],
    expectedVersion: execution.updatedAt.toISOString(),
    answers: { '0:0': true, '0:1': false },
    notes: 'Filtro substituído',
  };
  return { repository, tx, execution, input };
}
describe('registro do roteiro de PMOC', () => {
  it('impede gravação direta enquanto o ciclo aguarda aprovação', async () => {
    const { repository, tx, input } = fixture();
    tx.organization.findUnique.mockResolvedValue({
      settings: { operations: { requireAssignmentAuthorization: true } },
    });
    await expect(repository.saveEquipmentWork(input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.operation.update).not.toHaveBeenCalled();
  });
  it('impede conclusão direta enquanto o ciclo aguarda aprovação', async () => {
    const { repository, tx, input } = fixture();
    tx.organization.findUnique.mockResolvedValue({
      settings: { operations: { requireAssignmentAuthorization: true } },
    });
    await expect(
      repository.completeEquipmentExecution({
        organizationId: input.organizationId,
        planId: input.planId,
        cycleId: input.cycleId,
        executionId: input.executionId,
        actorId: input.actorId,
        restrictToTechnicianId: input.actorId,
        performedAt: new Date(),
        notes: undefined,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.pmocEquipmentExecution.updateMany).not.toHaveBeenCalled();
  });
  it('salva itens não realizados, notas e preserva os demais dados da operação', async () => {
    const { repository, tx, input } = fixture();
    await repository.saveEquipmentWork(input);
    expect(tx.operation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          data: {
            preserved: 'value',
            pmocChecklistAnswers: { '0:0': true, '0:1': false },
          },
        }),
      }),
    );
    expect(tx.pmocEquipmentExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ notes: 'Filtro substituído' }),
      }),
    );
  });
  it('recusa outra pessoa sem gravar dados', async () => {
    const { repository, tx, input } = fixture();
    await expect(
      repository.saveEquipmentWork({ ...input, actorId: 'other' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.operation.update).not.toHaveBeenCalled();
  });
  it('recusa uma revisão antiga e chaves não declaradas no roteiro', async () => {
    const { repository, input } = fixture();
    await expect(
      repository.saveEquipmentWork({ ...input, expectedVersion: 'old' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      repository.saveEquipmentWork({
        ...input,
        answers: { ...input.answers, unknown: true },
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});
