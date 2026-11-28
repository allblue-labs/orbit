import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import type { IHashProvider, IUuidProvider } from '../../contracts';
import { UnauthorizedException } from '../../exceptions';
import type { CustomerPortalTokenDelivery } from './customer-portal.types';
import { CustomerPortalMapper } from './customer-portal.mapper';
import { CustomerPortalMetrics } from './customer-portal.metrics';
import { CustomerPortalRepository } from './customer-portal.repository';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalTokenService } from './customer-portal-token.service';
import type { PortalIdentityRecord } from './customer-portal.types';

describe('CustomerPortalService', () => {
  const identity = (status = 'ACTIVE'): PortalIdentityRecord => ({
    id: '01900000-0000-7000-8000-000000000001',
    organizationId: '01900000-0000-7000-8000-000000000002',
    customerId: '01900000-0000-7000-8000-000000000003',
    contactId: null,
    email: 'portal@example.com',
    normalizedEmail: 'portal@example.com',
    displayName: 'Portal Customer',
    passwordHash: 'argon-hash',
    status,
    failedAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: new Date(),
    lastLoginAt: null,
    disabledAt: status === 'DISABLED' ? new Date() : null,
    organizationSlug: 'acme',
    organizationName: 'Acme',
    organizationStatus: 'ACTIVE',
    organizationDeletedAt: null,
    customerName: 'Acme Customer',
    customerStatus: 'ACTIVE',
    customerDeletedAt: null,
  });

  const setup = (
    record: PortalIdentityRecord | null = identity(),
    options: { connected?: boolean; mustChangePassword?: boolean } = {},
  ) => {
    const repository = {
      findLoginIdentityByEmail: jest.fn().mockResolvedValue(record),
      profileState: jest.fn().mockResolvedValue({
        mustChangePassword: options.mustChangePassword ?? false,
        avatarBucket: null,
        avatarObjectKey: null,
        avatarUpdatedAt: null,
        signatureBucket: null,
        signatureObjectKey: null,
        signatureUpdatedAt: null,
      }),
      accessContext: jest.fn().mockResolvedValue({
        slug: 'clima-norte',
        customerName: 'Clínica Sol LTDA',
        customerActive: true,
        identity: null,
      }),
      createAccess: jest
        .fn()
        .mockImplementation((data: { email: string; displayName: string }) =>
          Promise.resolve(portalRow(data)),
        ),
      resetAccessPassword: jest.fn().mockResolvedValue(
        portalRow({
          email: 'clinica.sol@clima-norte.com',
          displayName: 'Clínica Sol',
        }),
      ),
      invite: jest.fn(),
      consumeRateLimit: jest
        .fn()
        .mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
      findLoginIdentity: jest.fn().mockResolvedValue(record),
      recordFailedLogin: jest.fn().mockResolvedValue(undefined),
      createSession: jest.fn().mockImplementation((data: { id: string }) =>
        Promise.resolve({
          ...(record ?? identity()),
          sessionId: data.id,
          sessionExpiresAt: new Date(Date.now() + 60_000),
          sessionRevokedAt: null,
        }),
      ),
    };
    const verify = jest.fn().mockResolvedValue(true);
    const hash = jest.fn().mockResolvedValue('dummy-hash');
    const hashes: IHashProvider = { hash, verify };
    const uuids: IUuidProvider = {
      generate: jest
        .fn()
        .mockReturnValue('01900000-0000-7000-8000-000000000004'),
    };
    const tokens = {
      issue: jest.fn().mockResolvedValue({
        accessToken: 'portal-access',
        refreshToken: 'portal-refresh',
        refreshTokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        tokenType: 'Bearer',
        expiresIn: 900,
      }),
    };
    const delivery: CustomerPortalTokenDelivery = {
      connected: options.connected,
      deliver: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CustomerPortalService(
      repository as unknown as CustomerPortalRepository,
      tokens as unknown as CustomerPortalTokenService,
      new CustomerPortalMapper(),
      new CustomerPortalMetrics(),
      hashes,
      uuids,
      delivery,
    );
    return { service, repository, verify, tokens, hash };
  };

  const portalRow = (data: { email: string; displayName: string }) => ({
    id: '01900000-0000-7000-8000-000000000009',
    organizationId: identity().organizationId,
    customerId: identity().customerId,
    contactId: null,
    email: data.email,
    normalizedEmail: data.email,
    displayName: data.displayName,
    passwordHash: 'hash',
    status: 'ACTIVE',
    failedAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: new Date(),
    passwordUpdatedAt: new Date(),
    lastLoginAt: null,
    disabledAt: null,
    mustChangePassword: true,
    avatarBucket: null,
    avatarObjectKey: null,
    avatarUpdatedAt: null,
    signatureBucket: null,
    signatureObjectKey: null,
    signatureUpdatedAt: null,
    createdAt: new Date('2026-11-20T10:00:00.000Z'),
    updatedAt: new Date('2026-11-20T10:00:00.000Z'),
  });

  const ownerRequest = {
    identity: {
      id: '01900000-0000-7000-8000-000000000001',
      organizationId: '01900000-0000-7000-8000-000000000002',
    },
  } as unknown as IdentityRequest;

  describe('acesso criado pelo owner', () => {
    it('monta o e-mail com o domínio da organização, ignorando o que vier depois do @', async () => {
      const { service, repository, hash } = setup();

      const result = await service.createAccess(
        identity().customerId,
        ownerRequest,
        { localPart: 'Clínica Sol@gmail.com' },
      );

      expect(repository.createAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'clinica.sol@clima-norte.com',
          normalizedEmail: 'clinica.sol@clima-norte.com',
          displayName: 'Clínica Sol LTDA',
        }),
      );
      expect(result.temporaryPassword).toMatch(
        /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/,
      );
      /* A senha vai para o banco só como hash — a mesma que o owner recebe. */
      expect(hash).toHaveBeenCalledWith(result.temporaryPassword);
      expect(JSON.stringify(result.identity)).not.toContain('hash');
    });

    it('recusa parte local sem letra nem número', async () => {
      const { service, repository } = setup();
      await expect(
        service.createAccess(identity().customerId, ownerRequest, {
          localPart: '@@@',
        }),
      ).rejects.toMatchObject({ code: 'PORTAL_ACCESS_LOCAL_PART_INVALID' });
      expect(repository.createAccess).not.toHaveBeenCalled();
    });

    it('mostra o domínio e a sugestão antes de criar', async () => {
      const { service } = setup();
      await expect(
        service.access(identity().customerId, ownerRequest),
      ).resolves.toEqual({
        domain: 'clima-norte.com',
        suggestedLocalPart: 'clinica.sol',
        identity: null,
      });
    });

    it('nova senha devolve outra senha temporária, e 404 para acesso alheio', async () => {
      const { service, repository, hash } = setup();
      const result = await service.resetAccessPassword(
        identity().customerId,
        '01900000-0000-7000-8000-000000000009',
        ownerRequest,
      );
      expect(hash).toHaveBeenCalledWith(result.temporaryPassword);
      expect(result.identity.mustChangePassword).toBe(true);

      repository.resetAccessPassword.mockResolvedValueOnce(null);
      await expect(
        service.resetAccessPassword(
          identity().customerId,
          '01900000-0000-7000-8000-000000000009',
          ownerRequest,
        ),
      ).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
    });
  });

  it('entra só com e-mail quando o slug não vem', async () => {
    const { service, repository } = setup();
    await service.login(
      { email: 'clinica.sol@clima-norte.com', password: 'valid-password' },
      {},
    );
    expect(repository.findLoginIdentityByEmail).toHaveBeenCalledWith(
      'clinica.sol@clima-norte.com',
    );
    expect(repository.findLoginIdentity).not.toHaveBeenCalled();
  });

  it('a sessão diz que a senha temporária ainda precisa ser trocada', async () => {
    const { service } = setup(identity(), { mustChangePassword: true });
    const result = await service.login(
      { email: 'clinica.sol@clima-norte.com', password: 'valid-password' },
      {},
    );
    expect(result.me.mustChangePassword).toBe(true);
  });

  it('sem entrega de e-mail real, convite e recuperação recusam em vez de fingir que enviaram', async () => {
    const { service, repository } = setup(identity(), { connected: false });
    await expect(
      service.requestPasswordReset(
        { organizationSlug: 'acme', email: 'a@b.com' },
        {},
      ),
    ).rejects.toMatchObject({ code: 'PORTAL_EMAIL_DELIVERY_UNAVAILABLE' });
    await expect(
      service.invite(identity().customerId, ownerRequest, {
        email: 'a@b.com',
        displayName: 'Cliente',
      }),
    ).rejects.toMatchObject({ code: 'PORTAL_EMAIL_DELIVERY_UNAVAILABLE' });
    expect(repository.invite).not.toHaveBeenCalled();
  });

  it('derives organization/customer from the persisted identity when logging in', async () => {
    const { service, repository, tokens } = setup();
    const result = await service.login(
      {
        organizationSlug: 'ACME',
        email: 'PORTAL@example.com',
        password: 'valid-password',
      },
      { ipAddress: '127.0.0.1' },
    );

    expect(repository.findLoginIdentity).toHaveBeenCalledWith(
      'acme',
      'portal@example.com',
    );
    expect(tokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'CUSTOMER_PORTAL',
        organizationId: identity().organizationId,
        customerId: identity().customerId,
      }),
    );
    expect(result.me.actorType).toBe('CUSTOMER_PORTAL');
  });

  it('uses a dummy hash and the same generic error for an unknown identity', async () => {
    const { service, verify, repository } = setup(null);

    await expect(
      service.login(
        {
          organizationSlug: 'unknown',
          email: 'unknown@example.com',
          password: 'invalid-password',
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid credentials',
    });
    expect(verify).toHaveBeenCalledWith('dummy-hash', 'invalid-password');
    expect(repository.recordFailedLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['DISABLED', identity('DISABLED')],
    ['inactive customer', { ...identity(), customerStatus: 'INACTIVE' }],
    [
      'inactive organization',
      { ...identity(), organizationStatus: 'SUSPENDED' },
    ],
  ])('denies %s without issuing a session', async (_label, record) => {
    const { service, tokens } = setup(record);
    await expect(
      service.login(
        {
          organizationSlug: 'acme',
          email: 'portal@example.com',
          password: 'valid-password',
        },
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('fails closed when the distributed rate limiter denies the attempt', async () => {
    const { service, repository } = setup();
    repository.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });

    await expect(
      service.login(
        {
          organizationSlug: 'acme',
          email: 'portal@example.com',
          password: 'valid-password',
        },
        {},
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(repository.findLoginIdentity).not.toHaveBeenCalled();
  });
});
