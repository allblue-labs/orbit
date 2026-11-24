import { HotpathRateLimit } from './hotpath-rate-limit';
import type { HotpathRedis } from './hotpath-redis';

describe('HotpathRateLimit', () => {
  const command = jest.fn();
  const original = process.env;

  beforeEach(() => {
    process.env = {
      ...original,
      REDIS_HOTPATH_USER_RATE_MAX: '1',
      REDIS_HOTPATH_TENANT_RATE_MAX: '2',
    };
    command.mockReset();
  });

  afterEach(() => {
    process.env = original;
    jest.useRealTimers();
  });

  it('preserves the distributed retry delay', async () => {
    command.mockResolvedValue(7);
    const limits = new HotpathRateLimit({ command } as unknown as HotpathRedis);
    await expect(
      limits.authenticated('org', 'actor', 'internal'),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 7 },
    });
  });

  it('keeps local per-user and organization budgets during failure', async () => {
    jest.useFakeTimers();
    const limits = new HotpathRateLimit({ command } as unknown as HotpathRedis);
    await limits.authenticated('org1', 'actor1', 'internal');
    await expect(
      limits.authenticated('org1', 'actor1', 'internal'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await limits.authenticated('org1', 'actor2', 'portal');
    await expect(
      limits.authenticated('org1', 'actor3', 'portal'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await limits.authenticated('org2', 'actor1', 'internal');
    jest.advanceTimersByTime(60_000);
    await limits.authenticated('org1', 'actor1', 'internal');
  });
});
