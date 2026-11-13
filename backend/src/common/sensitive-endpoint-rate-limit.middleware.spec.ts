import type { NextFunction, Request, Response } from 'express';
import { SensitiveEndpointRateLimitMiddleware } from './sensitive-endpoint-rate-limit.middleware';

const request = (path: string, body: unknown = {}): Request =>
  ({
    socket: { remoteAddress: '192.0.2.10' },
    headers: {},
    method: 'POST',
    path,
    body,
  }) as Request;

describe('SensitiveEndpointRateLimitMiddleware', () => {
  const check = jest.fn().mockResolvedValue(undefined);
  const middleware = new SensitiveEndpointRateLimitMiddleware({
    check,
  } as never);
  beforeEach(() => check.mockClear());
  it.each([
    '/api/v1/identity/login',
    '/api/v1/identity/email/verify',
    '/api/v1/identity/email/resend',
    '/API/V1/IDENTITY/LOGIN/',
    '/identity/password/forgot',
    '/api/v1/billing/checkout-session',
  ])(
    'applies the shared budget without a NODE_ENV bypass: %s',
    async (path) => {
      const next = jest.fn() as NextFunction;
      await middleware.use(
        request(path, { email: '  USER@EXAMPLE.TEST ' }),
        {} as Response,
        next,
      );
      expect(check).toHaveBeenCalledWith(
        expect.any(String),
        '192.0.2.10',
        'email::user@example.test',
      );
      expect(next).toHaveBeenCalledTimes(1);
    },
  );
  it('does not consume for unrelated APIs or GET', async () => {
    const next = jest.fn() as NextFunction;
    await middleware.use(request('/api/v1/operations'), {} as Response, next);
    await middleware.use(
      { ...request('/api/v1/identity/login'), method: 'GET' } as Request,
      {} as Response,
      next,
    );
    expect(check).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
  });
  it('does not execute a handler when the shared store refuses', async () => {
    const next = jest.fn() as NextFunction;
    check.mockRejectedValueOnce(new Error('limited'));
    await expect(
      middleware.use(request('/identity/login'), {} as Response, next),
    ).rejects.toThrow('limited');
    expect(next).not.toHaveBeenCalled();
  });
});
