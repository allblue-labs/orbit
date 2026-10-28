/* Matchers assimétricos do Jest retornam any dentro dos objetos esperados. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { RecurringAuthorizationService } from './recurring-authorization.service';
import { RecurringAuthorizationQueryDto } from './dto/recurring-authorization.dto';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';

const actor = { id: 'owner', organizationId: 'org', businessUnitIds: ['unit'] };
const version = new Date('2026-10-28T12:00:00Z');
const visit = {
  id: 'visit',
  configurationId: 'rvt',
  sequenceNumber: 1,
  status: 'SCHEDULED',
  authorizedAt: null,
  responsibleFieldTechnicianId: 'tech',
  updatedAt: version,
  scheduledFor: new Date('2026-10-29T12:00:00Z'),
  execution: { operationId: 'rvt-operation' },
  configuration: { id: 'rvt', name: 'Visita mensal', code: 'RVT-1' },
};
const cycle = {
  id: 'cycle',
  planId: 'pmoc',
  sequenceNumber: 1,
  status: 'PENDING',
  authorizedAt: null,
  updatedAt: version,
  dueOn: new Date('2026-10-30'),
  operationId: null,
  plan: {
    id: 'pmoc',
    name: 'Manutenção',
    code: 'PMOC-1',
    technicianUserId: 'tech',
  },
  equipmentExecutions: [{ operationId: 'pmoc-operation' }],
};
function fixture(enabled = true) {
  const tx = {
    $executeRaw: jest.fn(),
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        settings: { operations: { requireAssignmentAuthorization: enabled } },
      }),
    },
    rvtOccurrence: {
      findMany: jest.fn().mockResolvedValue([visit]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(visit),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pmocExecution: {
      findMany: jest.fn().mockResolvedValue([cycle]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(cycle),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'tech', displayName: 'Técnico' }]),
    },
    operation: { updateMany: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const service = new RecurringAuthorizationService({
    run: (work: (client: typeof tx) => unknown) => work(tx),
  } as never);
  return { tx, service };
}

describe('autorização das visitas RVT e dos ciclos PMOC', () => {
  it('oferece as duas demandas na fila, sem criar operações nem iniciar visitas', async () => {
    const { tx, service } = fixture();
    const result = await service.list(
      actor,
      new RecurringAuthorizationQueryDto(),
    );
    expect(result.data.map((item) => item.kind)).toEqual(['RVT', 'PMOC']);
    expect(result.data[1].scheduledStart).toBe('2026-10-30');
    expect(result.meta.total).toBe(2);
    expect(tx.rvtOccurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org',
          businessUnitId: { in: ['unit'] },
          authorizedAt: null,
        }),
      }),
    );
    expect(tx.pmocExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org',
          authorizedAt: null,
          plan: expect.objectContaining({ businessUnitId: { in: ['unit'] } }),
        }),
      }),
    );
    expect(tx.operation.updateMany).not.toHaveBeenCalled();
  });
  it('não amplia o escopo ao receber um filtro de outra unidade', async () => {
    const { tx, service } = fixture();
    await service.list(actor, {
      ...new RecurringAuthorizationQueryDto(),
      businessUnitId: 'foreign-unit',
    });
    expect(tx.rvtOccurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessUnitId: { in: [] } }),
      }),
    );
    expect(tx.pmocExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          plan: expect.objectContaining({ businessUnitId: { in: [] } }),
        }),
      }),
    );
  });
  it('não oferece pendências nem aceita autorização quando o fluxo está desligado', async () => {
    const { tx, service } = fixture(false);
    expect(
      (await service.list(actor, new RecurringAuthorizationQueryDto())).data,
    ).toEqual([]);
    await expect(
      service.authorize(actor, [
        { kind: 'RVT', id: 'visit', version: version.toISOString() },
      ]),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(tx.rvtOccurrence.updateMany).not.toHaveBeenCalled();
  });
  it('autoriza exatamente as versões revisadas, carimba operações vinculadas e registra auditoria', async () => {
    const { tx, service } = fixture();
    await expect(
      service.authorize(actor, [
        { kind: 'RVT', id: 'visit', version: version.toISOString() },
        { kind: 'PMOC', id: 'cycle', version: version.toISOString() },
      ]),
    ).resolves.toEqual({ authorized: 2 });
    expect(tx.rvtOccurrence.updateMany).toHaveBeenCalledWith({
      where: { id: 'visit', organizationId: 'org', updatedAt: version },
      data: { authorizedAt: expect.any(Date), authorizedById: 'owner' },
    });
    expect(tx.pmocExecution.updateMany).toHaveBeenCalledWith({
      where: { id: 'cycle', organizationId: 'org', updatedAt: version },
      data: { authorizedAt: expect.any(Date), authorizedById: 'owner' },
    });
    expect(tx.operation.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(2);
  });
  it.each(['RVT', 'PMOC'] as const)(
    'recusa autorização obsoleta de %s sem carimbar a operação',
    async (kind) => {
      const { tx, service } = fixture();
      tx[
        kind === 'RVT' ? 'rvtOccurrence' : 'pmocExecution'
      ].updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.authorize(actor, [
          {
            kind,
            id: kind === 'RVT' ? 'visit' : 'cycle',
            version: version.toISOString(),
          },
        ]),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.operation.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    },
  );
  it('não autoriza uma visita fora da organização/unidade', async () => {
    const { tx, service } = fixture();
    tx.rvtOccurrence.findFirst.mockResolvedValue(null);
    await expect(
      service.authorize(actor, [
        { kind: 'RVT', id: 'foreign', version: version.toISOString() },
      ]),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(tx.rvtOccurrence.updateMany).not.toHaveBeenCalled();
  });
  it('não altera o autor nem a data de uma aprovação já registrada', async () => {
    const { tx, service } = fixture();
    tx.rvtOccurrence.findFirst.mockResolvedValue({
      ...visit,
      authorizedAt: version,
    });
    expect(
      await service.authorize(actor, [
        { kind: 'RVT', id: 'visit', version: version.toISOString() },
      ]),
    ).toEqual({ authorized: 0 });
    expect(tx.rvtOccurrence.updateMany).not.toHaveBeenCalled();
  });
});
