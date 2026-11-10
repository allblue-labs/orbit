import type { NextFunction, Request, Response } from 'express';
import { RateLimitException } from '../exceptions';
import { SensitiveEndpointRateLimitMiddleware } from './sensitive-endpoint-rate-limit.middleware';

const request = (path: string): Request =>
  ({ ip: '192.0.2.10', method: 'POST', path }) as Request;

describe('SensitiveEndpointRateLimitMiddleware', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'production',
      AUTH_RATE_LIMIT_MAX: '2',
      AUTH_RATE_LIMIT_WINDOW_MS: '60000',
    };
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it.each([
    '/api/v1/identity/login',
    '/api/v1/identity/email/verify',
    '/api/v1/identity/email/resend',
  ])('limits sensitive route %s before a third handler execution', (path) => {
    const middleware = new SensitiveEndpointRateLimitMiddleware();
    const next = jest.fn() as NextFunction;
    const input = request(path);

    middleware.use(input, {} as Response, next);
    middleware.use(input, {} as Response, next);

    expect(() => middleware.use(input, {} as Response, next)).toThrow(
      RateLimitException,
    );
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('does not consume the sensitive budget for unrelated APIs', () => {
    const middleware = new SensitiveEndpointRateLimitMiddleware();
    const next = jest.fn() as NextFunction;

    for (let index = 0; index < 25; index += 1) {
      middleware.use(request('/api/v1/operations'), {} as Response, next);
    }

    expect(next).toHaveBeenCalledTimes(25);
  });

  it('is disabled only in the explicit test runtime', () => {
    process.env.NODE_ENV = 'test';
    const middleware = new SensitiveEndpointRateLimitMiddleware();
    const next = jest.fn() as NextFunction;

    for (let index = 0; index < 25; index += 1) {
      middleware.use(request('/api/v1/identity/login'), {} as Response, next);
    }

    expect(next).toHaveBeenCalledTimes(25);
  });
});
