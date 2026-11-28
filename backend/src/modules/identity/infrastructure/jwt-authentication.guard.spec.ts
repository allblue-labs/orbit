import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '../../../exceptions';
import type { IdentityTokenService } from '../application/token.service';
import type { IdentityRepository } from './identity.repository';
import { JwtAuthenticationGuard } from './jwt-authentication.guard';

describe('JwtAuthenticationGuard error semantics', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
  const tokens = { verifyAccessToken: jest.fn() };
  const repository = {
    findSessionById: jest.fn(),
    revokeSession: jest.fn(),
  };
  const request = {
    method: 'GET',
    path: '/inventory',
    id: 'request-id',
    header: jest.fn().mockReturnValue('Bearer token'),
  };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new JwtAuthenticationGuard(
    reflector as unknown as Reflector,
    tokens as unknown as IdentityTokenService,
    repository as unknown as IdentityRepository,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    request.header.mockReturnValue('Bearer token');
    tokens.verifyAccessToken.mockResolvedValue({
      sub: 'user-id',
      sid: 'session-id',
      roles: [],
      permissions: [],
      businessUnitIds: [],
    });
    repository.findSessionById.mockResolvedValue({
      id: 'session-id',
      userId: 'user-id',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  it('returns 401 for an invalid token', async () => {
    const error = Object.assign(new Error('invalid signature'), {
      name: 'JsonWebTokenError',
    });
    tokens.verifyAccessToken.mockRejectedValue(error);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns 401 for an expired token', async () => {
    const error = Object.assign(new Error('jwt expired'), {
      name: 'TokenExpiredError',
    });
    tokens.verifyAccessToken.mockRejectedValue(error);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('returns 401 for a revoked session', async () => {
    repository.findSessionById.mockResolvedValue({
      id: 'session-id',
      userId: 'user-id',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each(['ECONNRESET', 'ETIMEDOUT'])(
    'rethrows infrastructure code %s instead of converting it to 401',
    async (code) => {
      const failure = Object.assign(new Error('database failure'), { code });
      repository.findSessionById.mockRejectedValue(failure);
      await expect(guard.canActivate(context)).rejects.toBe(failure);
    },
  );

  it('does not classify a token provider infrastructure failure as invalid credentials', async () => {
    const failure = Object.assign(
      new Error('verification backend unavailable'),
      {
        code: 'ECONNREFUSED',
      },
    );
    tokens.verifyAccessToken.mockRejectedValue(failure);
    await expect(guard.canActivate(context)).rejects.toBe(failure);
  });
});
