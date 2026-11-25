interface PersistedGlobalAssignment {
  id: string;
  userId: string;
  roleId: string;
  revokedAt: Date | null;
  role: {
    id: string;
    organizationId: string | null;
    deletedAt: Date | null;
    key: string;
    permissions: readonly string[];
    allowedSurfaces: readonly string[];
  };
}

const issued = new WeakSet<object>();

/**
 * Request-local proof derived exclusively from persisted global assignments.
 * Never deserialize this from a JWT, HTTP payload, job or corporate identity.
 * JSON clones, tenant roles and objects with a matching shape are not proofs.
 */
export class VerifiedPlatformAuthority {
  private constructor(
    readonly userId: string,
    readonly assignmentIds: readonly string[],
    readonly roles: readonly string[],
    readonly permissions: readonly string[],
    readonly allowedSurfaces: readonly string[],
  ) {
    issued.add(this);
    Object.freeze(this);
  }

  /** Called by IdentityRepository after reading assignments under user RLS. */
  static fromPersistedAssignments(
    userId: string,
    assignments: readonly PersistedGlobalAssignment[],
  ): VerifiedPlatformAuthority {
    const active = assignments.filter(
      (assignment) =>
        Boolean(assignment.id) &&
        assignment.userId === userId &&
        assignment.revokedAt === null &&
        assignment.roleId === assignment.role.id &&
        assignment.role.organizationId === null &&
        assignment.role.deletedAt === null,
    );
    return new VerifiedPlatformAuthority(
      userId,
      Object.freeze(active.map((assignment) => assignment.id)),
      Object.freeze([
        ...new Set(active.map((assignment) => assignment.role.key)),
      ]),
      Object.freeze([...new Set(active.flatMap((a) => a.role.permissions))]),
      Object.freeze([
        ...new Set(active.flatMap((a) => a.role.allowedSurfaces)),
      ]),
    );
  }

  static forUser(
    authority: VerifiedPlatformAuthority | undefined,
    userId: string | null | undefined,
  ): VerifiedPlatformAuthority | undefined {
    return authority && issued.has(authority) && authority.userId === userId
      ? authority
      : undefined;
  }

  static hasRole(
    authority: VerifiedPlatformAuthority | undefined,
    userId: string | null | undefined,
    role: string,
  ): boolean {
    return this.forUser(authority, userId)?.roles.includes(role) === true;
  }
}
