import { isReservedRoleKey, normalizeRoleKey } from './role-namespace';
import { OrganizationService } from '../modules/organizations/organization.service';
import { AuthorizationService } from './authorization.service';

describe('ORB-NX-01 tenant role namespace', () => {
  const repository = {
    findCurrent: jest.fn().mockResolvedValue({ id: 'tenant' }),
    findRole: jest.fn().mockResolvedValue({
      id: 'role',
      isSystem: false,
      permissions: [],
      allowedSurfaces: ['WEB'],
    }),
    createRole: jest.fn(),
    updateRole: jest.fn(),
  };
  const service = new OrganizationService(
    repository as never,
    new AuthorizationService(),
    {} as never,
  );
  const owner = { isOrganizationOwner: true } as never;
  beforeEach(() => jest.clearAllMocks());

  it.each([
    'PLATFORM_ADMIN',
    'platform admin',
    ' Plátform---Admín ',
    'PlatformAdmin',
    'platform.supervisor',
    'GLOBAL_ADMIN',
    'Corporate Admin',
    'nexus.admin',
  ])('rejects creation and rename for %s', async (name) => {
    expect(isReservedRoleKey(name)).toBe(true);
    await expect(service.createRole('tenant', { name }, owner)).rejects.toThrow(
      'reservado',
    );
    await expect(
      service.updateRole('role', 'tenant', { name }, owner),
    ).rejects.toThrow('reservado');
    expect(repository.createRole).not.toHaveBeenCalled();
    expect(repository.updateRole).not.toHaveBeenCalled();
  });

  it('preserves ordinary tenant role normalization', async () => {
    await service.createRole('tenant', { name: 'Técnico de campo' }, owner);
    expect(repository.createRole).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'TECNICO_DE_CAMPO',
        organizationId: 'tenant',
      }),
    );
    expect(normalizeRoleKey('Técnico de campo')).toBe('TECNICO_DE_CAMPO');
  });
});
