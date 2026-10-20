import { BusinessUnitType } from '../../contracts';
import { EntityNotFoundException, ValidationException } from '../../exceptions';
import { PlatformAdministrationService } from './platform-administration.service';

describe('PlatformAdministrationService', () => {
  const repository = {
    findOrganization: jest.fn(),
    findPlan: jest.fn(),
    updateOrganization: jest.fn(),
    overview: jest.fn(),
    listOrganizations: jest.fn(),
    listUsers: jest.fn(),
    plansAndModules: jest.fn(),
  };
  const registration = { register: jest.fn() };
  const hashes = {
    hash: jest.fn().mockResolvedValue('hash'),
    verify: jest.fn().mockResolvedValue(true),
  };
  const service = new PlatformAdministrationService(
    repository as never,
    registration as never,
    hashes,
  );

  beforeEach(() => jest.clearAllMocks());

  it('provisions the first tenant owner through the shared onboarding boundary', async () => {
    registration.register.mockResolvedValue({ organizationId: 'org-1' });
    repository.findOrganization.mockResolvedValue({ id: 'org-1' });
    await expect(
      service.createTenant('admin-1', {
        owner: {
          email: 'owner@example.com',
          firstName: 'Owner',
          lastName: 'Orbit',
          password: 'password-strong',
        },
        organizationName: 'Tenant Example',
        primarySegment: 'HVAC_R',
        planKey: 'STARTER',
        primaryBusinessUnit: {
          legalName: 'Tenant Example LTDA',
          type: BusinessUnitType.HEADQUARTERS,
          documentType: 'CNPJ',
          documentNumber: '11222333000181',
          city: 'Recife',
          street: 'Rua Principal',
          stateCode: 'PE',
        },
        organizationStatus: 'ACTIVE',
        subscriptionStatus: 'TRIALING',
      }),
    ).resolves.toEqual({ id: 'org-1' });
    expect(registration.register).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        planKey: 'STARTER',
      }),
      'hash',
      'tenant-example',
      expect.objectContaining({ actorUserId: 'admin-1', platformAdmin: true }),
    );
  });

  it('rejects an unknown plan during administrative changes', async () => {
    repository.findPlan.mockResolvedValue(null);
    await expect(
      service.updateOrganization('org-1', 'admin-1', { planKey: 'UNKNOWN' }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.updateOrganization).not.toHaveBeenCalled();
  });

  it('does not expose absent tenants as valid administration targets', async () => {
    repository.findOrganization.mockResolvedValue(null);
    await expect(service.organization('missing')).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });
});
