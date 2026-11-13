import { AuthRateLimitService } from './auth-rate-limit.service';

describe('orçamentos de requisições distribuídos', () => {
  const previous = { ...process.env };
  beforeEach(() => {
    process.env = {
      ...previous,
      AUTH_RATE_LIMIT_SECRET: 'a'.repeat(64),
      AUTH_RATE_LIMIT_MAX: '2',
      AUTH_RATE_LIMIT_ORIGIN_MAX: '10',
      AUTH_RATE_LIMIT_WINDOW_MS: '60000',
    };
  });
  afterAll(() => {
    process.env = previous;
  });
  it('persiste apenas HMACs e mantém conta e origem separados por ação', async () => {
    const query = jest
      .fn<
        Promise<{ allowed: boolean; retryAfterSeconds: number }[]>,
        [TemplateStringsArray, string, number, number]
      >()
      .mockResolvedValue([{ allowed: true, retryAfterSeconds: 0 }]);
    const service = new AuthRateLimitService({ $queryRaw: query } as never);
    await service.check(
      'identity/login',
      '192.0.2.1',
      'email:test@example.test',
    );
    await service.check(
      'identity/login',
      '192.0.2.2',
      'email:test@example.test',
    );
    expect(query.mock.calls[0]![1]).not.toBe(query.mock.calls[2]![1]);
    expect(query.mock.calls[1]![1]).toBe(query.mock.calls[3]![1]);
    expect(JSON.stringify(query.mock.calls)).not.toContain('test@example.test');
    expect(JSON.stringify(query.mock.calls)).not.toContain('192.0.2.1');
    await service.check(
      'identity/register',
      '192.0.2.1',
      'email:test@example.test',
    );
    expect(query.mock.calls[5]![1]).not.toBe(query.mock.calls[1]![1]);
  });
  it('preserva espera do banco e não conta uma conta quando a origem já foi recusada', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ allowed: false, retryAfterSeconds: 17 }]);
    await expect(
      new AuthRateLimitService({ $queryRaw: query } as never).check(
        'identity/login',
        'origin',
        'account',
      ),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 17 },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('falha fechada sem contador local quando o banco está indisponível', async () => {
    const query = jest.fn().mockRejectedValue(new Error('connection lost'));
    await expect(
      new AuthRateLimitService({ $queryRaw: query } as never).check(
        'identity/login',
        'origin',
      ),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});
