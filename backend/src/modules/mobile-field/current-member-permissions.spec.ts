import { currentMemberPermissions } from './current-member-permissions';

describe('current field permissions', () => {
  const membership = {
    organization: { ownerUserId: 'owner' },
    role: { permissions: ['operations.read', 'operations.update'] },
    usesCustomAccess: false,
    customPermissions: ['operations.read'],
  };
  it('resolves the real owner even when its role has no wildcard', () => {
    expect(
      currentMemberPermissions(
        { ...membership, role: { permissions: [] } },
        'owner',
      ),
    ).toEqual(['*']);
  });
  it('honors a member custom restriction and does not infer ownership from the role', () => {
    expect(
      currentMemberPermissions(
        { ...membership, usesCustomAccess: true },
        'member',
      ),
    ).toEqual(['operations.read']);
    expect(currentMemberPermissions(membership, 'member')).not.toContain('*');
  });
  it('fails closed when the active membership is gone', () => {
    expect(currentMemberPermissions(null, 'owner')).toEqual([]);
  });
});
