import {
  RequestContext,
  RequestContextService,
  RequestContextStorage,
} from '../../context';
import type { UUID } from '../../contracts';
import { TenantOperationPolicy } from './tenant-operation.policy';
import { TenantOperationAdminService } from './tenant-operation-admin.service';

const org = '01900000-0000-7000-8000-000000000001' as UUID;
function fixture(row: Record<string, unknown> | null) {
  const storage = new RequestContextStorage();
  const contexts = new RequestContextService(storage);
  const findFirst = jest.fn().mockResolvedValue(row);
  const rls = {
    run: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({ organization: { findFirst } }),
  };
  const policy = new TenantOperationPolicy(rls as never, contexts, storage);
  const run = <T>(fn: () => Promise<T>) =>
    storage.run(
      new RequestContext({
        requestId: 'nx03-unit',
        actorType: 'INTERNAL_USER',
        userId: org,
        organizationId: org,
        businessUnitId: null,
        businessUnitIds: [],
        roles: ['PLATFORM_ADMIN'],
        permissions: ['*'],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      fn,
    );
  return { policy, run, findFirst, rls, contexts };
}
describe('Operational policy is separate from financial eligibility', () => {
  it.each(['ACTIVE', 'ONBOARDING'])(
    'permits operational status %s independently of legacy billing flags',
    async (status) => {
      const f = fixture({
        id: org,
        status,
        updatedAt: new Date(),
        subscriptionStatus: 'EXPIRED',
      });
      await expect(
        f.run(() => f.policy.assertOperational()),
      ).resolves.toBeUndefined();
    },
  );
  it.each(['SUSPENDED', 'CANCELLED', 'UNKNOWN', 'active'])(
    'fails closed for %s even when a role name says PLATFORM_ADMIN',
    async (status) => {
      const f = fixture({
        id: org,
        status,
        updatedAt: new Date(),
        subscriptionStatus: 'ACTIVE',
      });
      await expect(
        f.run(() => f.policy.assertOperational()),
      ).rejects.toMatchObject({
        code:
          status === 'SUSPENDED'
            ? 'ORGANIZATION_SUSPENDED'
            : 'ORGANIZATION_UNAVAILABLE',
      });
    },
  );
  it('does not resume data already purging or no longer visible', async () => {
    for (const row of [
      null,
      {
        id: org,
        status: 'ACTIVE',
        updatedAt: new Date(),
        dataPurgeStartedAt: new Date(),
      },
    ]) {
      const f = fixture(row);
      await expect(
        f.run(() => f.policy.assertOperational()),
      ).rejects.toMatchObject({ code: 'ORGANIZATION_UNAVAILABLE' });
    }
  });
  it('does not memoize status across decisions or successive requests', async () => {
    const f = fixture({ id: org, status: 'ACTIVE', updatedAt: new Date() });
    await f.run(() => f.policy.assertOperational());
    f.findFirst.mockResolvedValue({
      id: org,
      status: 'SUSPENDED',
      updatedAt: new Date(),
    });
    await expect(
      f.run(() => f.policy.assertOperational()),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_SUSPENDED' });
  });
  it('rejects role strings and serialized authority before opening an administrative transaction', async () => {
    const f = fixture(null);
    const service = new TenantOperationAdminService(f.rls as never, f.contexts);
    await expect(
      f.run(() =>
        service.change(
          org,
          {
            status: 'ACTIVE',
            reason: 'RESOLVED',
            expectedUpdatedAt: new Date(),
          },
          'unit-test-key-12345',
        ),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.findFirst).not.toHaveBeenCalled();
  });
});
