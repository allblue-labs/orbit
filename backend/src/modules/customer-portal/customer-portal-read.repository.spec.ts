import { CustomerPortalReadRepository } from './customer-portal-read.repository';

describe('CustomerPortalReadRepository query bounds', () => {
  const scope = {
    organizationId: 'organization-id',
    customerId: 'customer-id',
  };
  const tx = {
    operation: { count: jest.fn(), findMany: jest.fn() },
    asset: { count: jest.fn(), findMany: jest.fn() },
    pmocPlan: { count: jest.fn(), findMany: jest.fn() },
    rvtConfiguration: { count: jest.fn(), findMany: jest.fn() },
    rvtOccurrence: { groupBy: jest.fn() },
    rvtConfigurationEquipment: { groupBy: jest.fn() },
    artifactManifest: { count: jest.fn(), findMany: jest.fn() },
  };
  const rls = {
    run: <T>(work: (value: typeof tx) => Promise<T>): Promise<T> => work(tx),
  };
  const repository = new CustomerPortalReadRepository(rls as never);

  beforeEach(() => {
    jest.clearAllMocks();
    for (const model of [
      tx.operation,
      tx.asset,
      tx.pmocPlan,
      tx.rvtConfiguration,
      tx.artifactManifest,
    ]) {
      model.count.mockResolvedValue(0);
      model.findMany.mockResolvedValue([]);
    }
    tx.rvtOccurrence.groupBy.mockResolvedValue([]);
    tx.rvtConfigurationEquipment.groupBy.mockResolvedValue([]);
  });

  it('uses two primary calls for operations, PMOC and documents', async () => {
    await repository.listOperations(scope, {
      page: 1,
      limit: 20,
      order: 'desc',
      sortBy: 'date',
    });
    await repository.listPmoc(scope, {
      page: 1,
      limit: 20,
      order: 'desc',
      sortBy: 'nextDueOn',
    });
    await repository.listDocuments(scope, {
      page: 1,
      limit: 20,
      order: 'desc',
      sortBy: 'issuedAt',
    });

    expect(tx.operation.count).toHaveBeenCalledTimes(1);
    expect(tx.operation.findMany).toHaveBeenCalledTimes(1);
    expect(tx.pmocPlan.count).toHaveBeenCalledTimes(1);
    expect(tx.pmocPlan.findMany).toHaveBeenCalledTimes(1);
    expect(tx.artifactManifest.count).toHaveBeenCalledTimes(1);
    expect(tx.artifactManifest.findMany).toHaveBeenCalledTimes(1);
  });

  it('uses one bounded aggregate in addition to each asset/RVT page', async () => {
    tx.asset.findMany.mockResolvedValue([{ id: 'asset-id' }]);
    tx.rvtConfiguration.findMany.mockResolvedValue([{ id: 'rvt-id' }]);
    await repository.listAssets(scope, {
      page: 1,
      limit: 20,
      order: 'asc',
      sortBy: 'name',
    });
    await repository.listRvt(scope, {
      page: 1,
      limit: 20,
      order: 'desc',
      sortBy: 'coverageStart',
    });

    expect(tx.asset.count).toHaveBeenCalledTimes(1);
    expect(tx.asset.findMany).toHaveBeenCalledTimes(1);
    expect(tx.rvtConfigurationEquipment.groupBy).toHaveBeenCalledTimes(1);
    expect(tx.rvtConfiguration.count).toHaveBeenCalledTimes(1);
    expect(tx.rvtConfiguration.findMany).toHaveBeenCalledTimes(1);
    expect(tx.rvtOccurrence.groupBy).toHaveBeenCalledTimes(1);
  });
});
