import { VerifiedPlatformAuthority as Authority } from './verified-platform-authority';
import { AuthorizationService } from './authorization.service';
import { RlsContextProvider } from '../database/rls/rls-context.provider';
import { toAuthenticatedIdentity } from '../modules/identity/application/authentication.service';

const assignment = {
  id: 'grant',
  userId: 'user',
  roleId: 'role',
  revokedAt: null,
  role: {
    id: 'role',
    organizationId: null,
    deletedAt: null,
    key: 'PLATFORM_ADMIN',
    permissions: ['platform.admin'],
    allowedSurfaces: ['WEB'],
  },
};

describe('ORB-NX-01 verified global authority', () => {
  const authorization = new AuthorizationService();
  const authority = () =>
    Authority.fromPersistedAssignments('user', [assignment]);
  const actor = {
    id: 'user',
    userId: 'user',
    roles: ['PLATFORM_ADMIN'],
    permissions: ['*', 'platform.admin'],
    isOrganizationOwner: false,
  };

  it('rejects role strings, tenant wildcard and structural owner as platform proof', () => {
    for (const isOrganizationOwner of [false, true]) {
      expect(
        authorization.hasAnyRole({ ...actor, isOrganizationOwner }, [
          'PLATFORM_ADMIN',
        ]),
      ).toBe(false);
      expect(
        authorization.hasPermissions({ ...actor, isOrganizationOwner }, [
          'platform.admin',
        ]),
      ).toBe(false);
    }
  });

  it('accepts a real request-local proof but rejects clones and cross-user reuse', () => {
    const proof = authority();
    expect(
      authorization.hasAnyRole({ ...actor, platformAuthority: proof }, [
        'PLATFORM_ADMIN',
      ]),
    ).toBe(true);
    expect(
      authorization.hasPermissions({ ...actor, platformAuthority: proof }, [
        'platform.admin',
      ]),
    ).toBe(true);
    expect(
      Authority.hasRole(
        JSON.parse(JSON.stringify(proof)) as Authority,
        'user',
        'PLATFORM_ADMIN',
      ),
    ).toBe(false);
    expect(Authority.hasRole(proof, 'another-user', 'PLATFORM_ADMIN')).toBe(
      false,
    );
    expect(Object.isFrozen(proof.roles)).toBe(true);
  });

  it.each([
    { revokedAt: new Date() },
    { userId: 'other' },
    { roleId: 'other' },
    { role: { ...assignment.role, organizationId: 'tenant' } },
    { role: { ...assignment.role, deletedAt: new Date() } },
  ])('rejects invalid persisted assignment provenance: %j', (patch) => {
    const proof = Authority.fromPersistedAssignments('user', [
      { ...assignment, ...patch },
    ]);
    expect(Authority.hasRole(proof, 'user', 'PLATFORM_ADMIN')).toBe(false);
  });

  it('legacy tenant role and platform permission never become global grants', () => {
    const identity = toAuthenticatedIdentity(
      {
        id: 'user',
        platformRoleAssignments: [assignment],
        organizationMemberships: [
          { organizationId: 'tenant', role: assignment.role },
        ],
        effectiveBusinessUnitIds: [],
        isOrganizationOwner: false,
      } as never,
      'session' as never,
    );
    expect(identity.roles).toEqual([]);
    expect(identity.permissions).not.toContain('platform.admin');
    expect(identity.organizationRoles).toEqual([]);
  });

  it('RLS requires verified provenance, matching user and internal actor', () => {
    const base = { ...actor, businessUnitIds: [], actorType: 'INTERNAL_USER' };
    const rls = (patch: object) =>
      new RlsContextProvider({
        get: () => ({ ...base, ...patch }),
      } as never).get().isPlatformAdmin;
    expect(rls({})).toBe('false');
    expect(rls({ platformAuthority: authority() })).toBe('true');
    expect(rls({ platformAuthority: authority(), userId: 'other' })).toBe(
      'false',
    );
    expect(rls({ platformAuthority: authority(), actorType: 'SYSTEM' })).toBe(
      'false',
    );
    expect(
      rls({ platformAuthority: authority(), actorType: 'CUSTOMER_PORTAL' }),
    ).toBe('false');
  });
});
