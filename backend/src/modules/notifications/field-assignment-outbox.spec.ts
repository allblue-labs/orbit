import type { EnqueueJobInput } from '../jobs/background-job.types';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { FieldAssignmentOutbox } from './field-assignment-outbox';

const row = {
  id: 'source',
  organizationId: 'tenant',
  businessUnitId: 'unit',
  updatedAt: new Date('2026-11-14T12:00:00Z'),
  deletedAt: null,
  authorizedAt: null,
  status: 'SCHEDULED',
  responsibleFieldTechnicianId: 'technician',
};
function fixture(required = false) {
  const tx = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        settings: {
          operations: { requireAssignmentAuthorization: required },
        },
      }),
    },
    operation: {
      findUnique: jest.fn().mockResolvedValue({
        ...row,
        status: 'OPEN',
        auxiliaryTechnicians: [
          { userId: 'technician' },
          { userId: 'auxiliary' },
        ],
      }),
    },
    rvtOccurrence: { findUnique: jest.fn().mockResolvedValue(row) },
    pmocExecution: {
      findUnique: jest.fn().mockResolvedValue({
        ...row,
        status: 'PENDING',
        plan: {
          businessUnitId: 'unit',
          status: 'ACTIVE',
          deletedAt: null,
          schedulingPaused: false,
          technicianUserId: 'planned-technician',
          coverages: [
            { assetId: 'planned' },
            { assetId: 'overridden' },
            { assetId: 'cancelled' },
          ],
        },
        equipmentExecutions: [],
        equipmentSchedules: [
          {
            coverage: { assetId: 'overridden' },
            responsibleFieldTechnicianId: 'replacement',
            auxiliaryTechnicianIds: ['auxiliary'],
            cancelledAt: null,
          },
          {
            coverage: { assetId: 'cancelled' },
            cancelledAt: new Date(),
            auxiliaryTechnicianIds: [],
          },
        ],
      }),
    },
  };
  const enqueue = jest
    .fn<Promise<{ id: string }>, [EnqueueJobInput, PrismaTransactionClient?]>()
    .mockResolvedValue({ id: 'job' });
  return {
    tx,
    enqueue,
    outbox: new FieldAssignmentOutbox({ enqueue } as never),
  };
}

describe('FieldAssignmentOutbox', () => {
  it('não enfileira RVT pendente da autorização do owner', async () => {
    const { tx, enqueue, outbox } = fixture(true);
    await outbox.rvt(tx as never, row.id);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('autorizar mantém o destinatário e o escopo na mesma transação', async () => {
    const { tx, enqueue, outbox } = fixture();
    await outbox.rvt(tx as never, row.id);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      actorUserId: 'technician',
      organizationId: 'tenant',
      businessUnitId: 'unit',
      payload: { workItemId: 'RVT:source' },
    });
    expect(enqueue.mock.calls[0]?.[1]).toBe(tx);
  });
  it('deduplica destinatários de OS e inclui o auxiliar atribuído', async () => {
    const { tx, enqueue, outbox } = fixture();
    await outbox.operation(tx as never, row.id);
    expect(enqueue.mock.calls.map((call) => call[0].actorUserId)).toEqual([
      'technician',
      'auxiliary',
    ]);
  });
  it('PMOC usa o técnico substituto por equipamento e ignora agendamento cancelado', async () => {
    const { tx, enqueue, outbox } = fixture();
    await outbox.pmoc(tx as never, row.id);
    expect(enqueue.mock.calls.map((call) => call[0].actorUserId)).toEqual([
      'planned-technician',
      'replacement',
      'auxiliary',
    ]);
  });
  it('falha de outbox propaga para abortar a transação do domínio', async () => {
    const { tx, enqueue, outbox } = fixture();
    enqueue.mockRejectedValue(new Error('storage unavailable'));
    await expect(outbox.rvt(tx as never, row.id)).rejects.toThrow(
      'storage unavailable',
    );
  });
});
