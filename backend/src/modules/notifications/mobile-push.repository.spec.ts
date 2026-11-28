import type { Prisma } from '@prisma/client';
import { MobilePushRepository } from './mobile-push.repository';
import { MobileNotificationPolicy } from './mobile-notification.policy';

const org = '01900000-0000-7000-8000-000000000001';
const user = '01900000-0000-7000-8000-000000000002';
const cycle = '01900000-0000-7000-8000-000000000003';
const asset = '01900000-0000-7000-8000-000000000004';
const intent = {
  organizationId: org,
  businessUnitId: 'unit',
  recipientUserId: user,
  type: 'WORK_ASSIGNED' as const,
  resourceId: 'operation',
  factId: 'assignment',
  correlationId: 'correlation',
};

function fixture() {
  const tx = {
    organizationMembership: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member' }),
      count: jest.fn().mockResolvedValue(1),
    },
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        settings: { operations: { requireAssignmentAuthorization: true } },
      }),
    },
    businessUnitMembership: { count: jest.fn().mockResolvedValue(1) },
    notification: {
      upsert: jest
        .fn<Promise<{ id: string }>, [Prisma.NotificationUpsertArgs]>()
        .mockResolvedValue({ id: 'notification' }),
    },
    notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    mobileDeviceInstallation: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'phone' }, { id: 'tablet' }]),
      updateMany: jest
        .fn<
          Promise<{ count: number }>,
          [Prisma.MobileDeviceInstallationUpdateManyArgs]
        >()
        .mockResolvedValue({ count: 0 }),
    },
    mobilePushDelivery: {
      createMany: jest.fn(),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'phone-delivery' },
          { id: 'tablet-delivery' },
        ]),
      update: jest.fn<Promise<void>, [Prisma.MobilePushDeliveryUpdateArgs]>(),
    },
    pmocExecution: {
      findFirst: jest
        .fn<
          Promise<{ id: string } | null>,
          [Prisma.PmocExecutionFindFirstArgs]
        >()
        .mockResolvedValue({ id: cycle }),
    },
    operation: {
      findFirst: jest
        .fn<Promise<{ id: string } | null>, [Prisma.OperationFindFirstArgs]>()
        .mockResolvedValue({ id: 'operation' }),
    },
  };
  const run = jest.fn(async (work: (client: typeof tx) => Promise<unknown>) =>
    work(tx),
  );
  const enqueue = jest.fn();
  return {
    tx,
    run,
    enqueue,
    repository: new MobilePushRepository(
      { run, runAmbient: run } as never,
      { enqueue } as never,
    ),
  };
}

describe('MobilePushRepository tenant isolation and cleanup', () => {
  it('respeita a preferência desativada depois que a notificação já entrou na fila', async () => {
    const { repository, tx } = fixture();
    tx.notificationPreference.findUnique.mockResolvedValue({
      enabled: false,
      channels: ['PUSH'],
    });
    await expect(
      repository.eligible({ ...intent, payload: { resourceId: 'operation' } }),
    ).resolves.toBe(false);
    expect(tx.operation.findFirst).not.toHaveBeenCalled();
  });
  it('gera uma entrega por dispositivo ativo, filtrando usuário e organização e preservando o escopo do worker', async () => {
    const { repository, tx, enqueue } = fixture();
    await repository.materialize(
      intent,
      new MobileNotificationPolicy().resolve(intent),
    );
    expect(tx.mobileDeviceInstallation.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: org,
        userId: user,
        enabled: true,
        revokedAt: null,
      },
      select: { id: true },
    });
    expect(tx.mobilePushDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          organizationId: org,
          notificationId: 'notification',
          installationId: 'phone',
        }),
        expect.objectContaining({
          organizationId: org,
          notificationId: 'notification',
          installationId: 'tablet',
        }),
      ],
      skipDuplicates: true,
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: org,
        actorUserId: user,
        businessUnitId: 'unit',
        maxAttempts: 5,
      }),
      tx,
    );
  });
  it('não cria aviso ou entrega para usuário de outra organização ou inativo', async () => {
    const { repository, tx, enqueue } = fixture();
    tx.organizationMembership.findFirst.mockResolvedValue(null);
    await expect(
      repository.materialize(
        intent,
        new MobileNotificationPolicy().resolve(intent),
      ),
    ).resolves.toBeNull();
    expect(tx.notification.upsert).not.toHaveBeenCalled();
    expect(tx.mobileDeviceInstallation.findMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('persiste os dados customizados que serão lidos pelo worker de entrega', async () => {
    const { repository, tx } = fixture();
    const custom = {
      ...intent,
      type: 'TRANSACTIONAL' as const,
      message: {
        title: 'Aviso',
        body: 'Abra o Orbit.',
        data: { tipo: 'promocao', url: 'https://loja.example.com' },
      },
    };
    await repository.materialize(
      custom,
      new MobileNotificationPolicy().resolve(custom),
    );
    expect(tx.notification.upsert.mock.calls[0]?.[0]).toMatchObject({
      create: { payload: { data: custom.message.data } },
    });
  });
  it('invalida somente o token que falhou, na mesma transação do resultado de entrega', async () => {
    const { repository, tx, run } = fixture();
    await repository.invalidateToken(
      'delivery',
      'phone',
      'old-hash',
      'messaging/registration-token-not-registered',
      'firebase-admin',
    );
    expect(run).toHaveBeenCalledTimes(1);
    const invalidation =
      tx.mobileDeviceInstallation.updateMany.mock.calls[0]?.[0];
    expect(invalidation).toMatchObject({
      where: {
        id: 'phone',
        pushTokenHash: 'old-hash',
        enabled: true,
        revokedAt: null,
      },
      data: { enabled: false },
    });
    expect(invalidation?.data.revokedAt).toBeInstanceOf(Date);
    expect(tx.mobilePushDelivery.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 'delivery' },
      data: { status: 'INVALID_TOKEN' },
    });
  });
  it('valida atribuição PMOC no ciclo/equipamento correto e exige autorização vigente', async () => {
    const { repository, tx } = fixture();
    await expect(
      repository.eligible({
        organizationId: org,
        businessUnitId: 'unit',
        recipientUserId: user,
        type: 'WORK_ASSIGNED',
        payload: {
          resourceId: 'equipment-execution',
          workItemId: `PMOC:${cycle}:${asset}`,
        },
      }),
    ).resolves.toBe(true);
    expect(tx.operation.findFirst).not.toHaveBeenCalled();
    const query = tx.pmocExecution.findFirst.mock.calls[0]?.[0];
    expect(query?.where).toMatchObject({
      id: cycle,
      organizationId: org,
      authorizedAt: { not: null },
    });
    expect(query?.where?.OR).toContainEqual({
      equipmentSchedules: {
        some: {
          organizationId: org,
          cancelledAt: null,
          coverage: { assetId: asset, deletedAt: null },
          OR: [
            { responsibleFieldTechnicianId: user },
            { auxiliaryTechnicianIds: { has: user } },
          ],
        },
      },
    });
  });
  it('revalida a autorização e a atribuição para operação comum', async () => {
    const { repository, tx } = fixture();
    await repository.eligible({
      ...intent,
      payload: { resourceId: 'operation' },
    });
    expect(tx.operation.findFirst.mock.calls[0]?.[0].where).toMatchObject({
      id: 'operation',
      organizationId: org,
      authorizedAt: { not: null },
    });
  });
});
