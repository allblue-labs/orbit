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
    '/api/v1/public/contact',
    '/identity/password/reset/validate',
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
  it('keeps one route budget and one canonical token budget for public approvals', async () => {
    const token = 'A'.repeat(64);
    const next = jest.fn() as NextFunction;
    await middleware.use(
      request(`/API/V1/PUBLIC/QUOTES/PROPOSALS/%41${token.slice(1)}/RESPONSE/`),
      {} as Response,
      next,
    );
    expect(check).toHaveBeenCalledWith(
      'public/quotes/response',
      '192.0.2.10',
      `token:${token}`,
    );
  });
  it('does not execute a handler when the shared store refuses', async () => {
    const next = jest.fn() as NextFunction;
    check.mockRejectedValueOnce(new Error('limited'));
    await expect(
      middleware.use(request('/identity/login'), {} as Response, next),
    ).rejects.toThrow('limited');
    expect(next).not.toHaveBeenCalled();
  });
  it.each([
    '/api/v1/identity/biometrics/webauthn/authentication/options',
    '/api/v1/portal/auth/biometrics/webauthn/authentication/options',
    '/api/v1/identity/biometrics/devices/authentication/options',
    '/api/v1/portal/auth/biometrics/devices/authentication/options',
  ])(
    'uses one challenge budget for both audiences before database work: %s',
    async (path) => {
      const next = jest.fn() as NextFunction;
      await middleware.use(request(path), {} as Response, next);
      expect(check).toHaveBeenCalledWith('passkey-challenge', '192.0.2.10');
      expect(next).toHaveBeenCalledTimes(1);
    },
  );
});
