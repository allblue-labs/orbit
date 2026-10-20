import { ConflictException } from '../../exceptions';
import { MobileFieldOperationRepository } from './mobile-field-operation.repository';

const organizationId = '01900000-0000-7000-8000-000000000001';
const operationId = '01900000-0000-7000-8000-000000000002';
const actorId = '01900000-0000-7000-8000-000000000003';

function harness(receiptOperationId = operationId) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    operation: {
      findFirst: jest.fn().mockResolvedValue({
        id: operationId,
        organizationId,
        businessUnitId: '01900000-0000-7000-8000-000000000004',
        responsibleFieldTechnicianId: actorId,
        auxiliaryTechnicians: [],
        checklistExecutions: [],
      }),
    },
    professionalProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'profile' }),
    },
    businessUnitMembership: {
      findFirst: jest.fn().mockResolvedValue({ id: 'membership' }),
    },
    operationHistory: {
      findFirst: jest.fn().mockResolvedValue({
        operationId: receiptOperationId,
        details: { idempotencyKey: 'command-key', payloadHash: 'hash' },
      }),
    },
  };
  const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
  const repository = new MobileFieldOperationRepository(
    rls as never,
    { publish: jest.fn() } as never,
  );
  return { repository, tx };
}

describe('MobileFieldOperationRepository idempotency receipt', () => {
  it('queries the exact JSON idempotency key without a recency cap', async () => {
    const { repository, tx } = harness();

    const result = await repository.transition({
      operationId,
      organizationId,
      actorId,
      expectedVersion: new Date(0).toISOString(),
      idempotencyKey: 'command-key',
      payloadHash: 'hash',
      target: 'IN_PROGRESS',
    });

    expect(result.idempotentReplay).toBe(true);
    expect(tx.operationHistory.findFirst).toHaveBeenCalledWith({
      where: {
        operation: { organizationId },
        userId: actorId,
        action: 'FIELD_OPERATION_STARTED',
        details: { path: ['idempotencyKey'], equals: 'command-key' },
      },
      orderBy: { createdAt: 'desc' },
      select: { operationId: true, details: true },
    });
  });

  it('rejects reuse of an actor key by another operation', async () => {
    const { repository } = harness('01900000-0000-7000-8000-000000000099');

    await expect(
      repository.transition({
        operationId,
        organizationId,
        actorId,
        expectedVersion: new Date(0).toISOString(),
        idempotencyKey: 'command-key',
        payloadHash: 'hash',
        target: 'IN_PROGRESS',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
