import { VerifiedPlatformAuthority } from '../../common/verified-platform-authority';
import { PlatformAdministrationService } from './platform-administration.service';
import {
  ForbiddenException,
  ValidationException,
  ConflictException,
} from '../../exceptions';

const authority = VerifiedPlatformAuthority.fromPersistedAssignments('admin', [
  {
    id: 'grant',
    userId: 'admin',
    roleId: 'global-role',
    revokedAt: null,
    role: {
      id: 'global-role',
      organizationId: null,
      deletedAt: null,
      key: 'PLATFORM_ADMIN',
      permissions: ['platform.admin'],
      allowedSurfaces: ['WEB'],
    },
  },
]);

describe('PlatformAdministrationService canonical boundary', () => {
  const tx = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
  const repository = {
    transaction: jest.fn((work: (tx: unknown) => unknown) =>
      Promise.resolve(work(tx)),
    ),
    updateOrganization: jest.fn(),
    findOrganization: jest.fn(),
  };
  const contexts = {
    get: () => ({
      userId: 'admin',
      actorType: 'INTERNAL_USER',
      platformAuthority: authority,
      requestId: 'request',
    }),
  };
  const service = new PlatformAdministrationService(
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    contexts as never,
    {} as never,
  );
  beforeEach(() => jest.clearAllMocks());
  it('does not accept a tenant role string or structural owner as global authority', async () => {
    const unsafe = new PlatformAdministrationService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        get: () => ({
          userId: 'tenant-owner',
          actorType: 'INTERNAL_USER',
          roles: ['PLATFORM_ADMIN'],
          isOrganizationOwner: true,
        }),
      } as never,
      {} as never,
    );
    await expect(unsafe.organization('tenant')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.findOrganization).not.toHaveBeenCalled();
  });
  it('audits rejected legacy billing writes without turning them into canonical commands', async () => {
    repository.updateOrganization.mockRejectedValue(
      new Error('ADMIN_FINANCIAL_FIELDS_READ_ONLY'),
    );
    await expect(
      service.updateOrganization('tenant', 'admin', {
        subscriptionStatus: 'ACTIVE',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
    const call = tx.auditLog.create.mock.calls[0] as unknown as [
      {
        data: {
          action: string;
          metadata: {
            grantIds: string[];
            correlationId: string;
            result: string;
          };
        };
      },
    ];
    expect(call[0].data.action).toBe('PLATFORM_ORGANIZATION_UPDATE_REJECTED');
    expect(call[0].data.metadata).toMatchObject({
      grantIds: ['grant'],
      correlationId: 'request',
      result: 'REJECTED',
    });
  });
  it('exposes optimistic concurrency conflicts explicitly', async () => {
    repository.updateOrganization.mockRejectedValue(
      new Error('ADMIN_VERSION_CONFLICT'),
    );
    await expect(
      service.updateOrganization('tenant', 'admin', {
        displayName: 'New tenant',
        expectedUpdatedAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
