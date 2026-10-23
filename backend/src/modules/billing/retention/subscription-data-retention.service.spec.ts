import { SubscriptionDataRetentionService } from './subscription-data-retention.service';

function fixture() {
  const source = {
    id: 'subscription',
    organizationId: 'org',
    providerSubscriptionId: 'sub_remote',
  };
  const tx = {
    $queryRaw: jest.fn(),
    organizationSubscription: {
      findMany: jest.fn().mockResolvedValue([source]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    billingCheckoutAttempt: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    storageDeletionJob: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: (work: (tx: unknown) => Promise<unknown>) => work(tx),
  };
  const provider = {
    isEnabled: () => true,
    retrieveSubscription: jest.fn().mockResolvedValue({ state: 'ACTIVE' }),
    retrieveCheckoutSession: jest.fn(),
    expireCheckoutSession: jest.fn(),
  };
  const files = { remove: jest.fn() };
  return {
    service: new SubscriptionDataRetentionService(
      prisma as never,
      provider as never,
      files as never,
      { name: 'LOCAL' } as never,
    ),
    tx,
    provider,
    files,
  };
}

describe('automatic cancellation retention safeguards', () => {
  it('preserves a paid return already linked to Stripe while activation is being reconciled', async () => {
    const { service, tx, provider } = fixture();
    tx.organizationSubscription.findFirst.mockResolvedValue({
      status: 'PENDING_PAYMENT',
      providerSubscriptionId: 'sub_new_purchase',
    });
    await service.run();
    expect(provider.retrieveSubscription).not.toHaveBeenCalled();
    expect(tx.organizationSubscription.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it('continues scanning when the first page is waiting for financial confirmation', async () => {
    const { service, tx, provider } = fixture();
    tx.organizationSubscription.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 25 }, (_, index) => ({
          id: `subscription-${index}`,
          organizationId: 'org',
          providerSubscriptionId: 'sub_remote',
        })),
      )
      .mockResolvedValueOnce([
        {
          id: 'last-subscription',
          organizationId: 'org',
          providerSubscriptionId: 'last-remote',
        },
      ]);
    await service.run();
    expect(provider.retrieveSubscription).toHaveBeenCalledWith('last-remote');
    expect(tx.organizationSubscription.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { gt: 'subscription-24' },
        }) as unknown,
      }),
    );
  });
  it('queries only explicitly scheduled deadlines and requires the provider subscription to be ended', async () => {
    const { service, tx, provider } = fixture();
    const at = new Date('2026-10-23T12:00:00Z');
    await service.run(at);
    expect(tx.organizationSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dataRetentionEndsAt: { lte: at } } }),
    );
    expect(provider.retrieveSubscription).toHaveBeenCalledWith('sub_remote');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3); // Scoped reads, no claim/purge.
  });

  it.each(['COMPLETE', 'UNKNOWN'])(
    'preserves data while checkout is %s',
    async (state) => {
      const { service, tx, provider } = fixture();
      provider.retrieveSubscription.mockResolvedValue({ state: 'ENDED' });
      tx.billingCheckoutAttempt.findMany.mockResolvedValue([
        { id: 'attempt', providerSessionId: 'cs_remote' },
      ]);
      provider.retrieveCheckoutSession.mockResolvedValue({ state });
      await service.run();
      expect(provider.expireCheckoutSession).not.toHaveBeenCalled();
      expect(tx.billingCheckoutAttempt.updateMany).not.toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    },
  );

  it('retains unfinished checkout creation instead of assuming it failed', async () => {
    const { service, tx, provider } = fixture();
    provider.retrieveSubscription.mockResolvedValue({ state: 'ENDED' });
    tx.billingCheckoutAttempt.findMany.mockResolvedValue([
      { id: 'attempt', providerSessionId: null },
    ]);
    await service.run();
    expect(provider.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(tx.billingCheckoutAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('deletes a queued object before acknowledging its removal', async () => {
    const { service, tx, files } = fixture();
    tx.organizationSubscription.findMany.mockResolvedValue([]);
    tx.storageDeletionJob.findMany.mockResolvedValue([
      { id: 'job', provider: 'LOCAL', bucket: 'bucket', objectKey: 'key' },
    ]);
    await service.run();
    expect(files.remove).toHaveBeenCalledWith('bucket', 'key');
    expect(tx.storageDeletionJob.deleteMany).toHaveBeenCalledWith({
      where: { id: 'job' },
    });
    expect(files.remove.mock.invocationCallOrder[0]).toBeLessThan(
      tx.storageDeletionJob.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('retries storage failures without losing the only object reference', async () => {
    const { service, tx, files } = fixture();
    const at = new Date('2026-10-23T12:00:00Z');
    tx.organizationSubscription.findMany.mockResolvedValue([]);
    tx.storageDeletionJob.findMany.mockResolvedValue([
      {
        id: 'job',
        provider: 'LOCAL',
        bucket: 'bucket',
        objectKey: 'key',
        attempts: 0,
      },
    ]);
    files.remove.mockRejectedValue(new Error('storage unavailable'));
    await service.run(at);
    expect(tx.storageDeletionJob.deleteMany).not.toHaveBeenCalled();
    expect(tx.storageDeletionJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job' },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt: new Date(at.getTime() + 60_000),
      },
    });
  });
});
