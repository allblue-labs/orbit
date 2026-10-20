import { Inject, Injectable } from '@nestjs/common';
import type { IHashProvider, IUuidProvider, UUID } from '../../../contracts';
import { HASH_PROVIDER, UUID_PROVIDER } from '../../../providers';
import { UnauthorizedException } from '../../../exceptions';
import type {
  AuthenticatedIdentity,
  SessionMetadata,
  TokenPair,
} from '../domain/identity.types';
import {
  IdentityRepository,
  type IdentityUser,
} from '../infrastructure/identity.repository';
import {
  SurfaceNotAllowedException,
  allowsSurface,
  normalizeSurface,
} from '../domain/surface-access';
import { IdentityTokenService } from './token.service';
import { MfaService } from './mfa.service';

/** Pure, shared resolution used at issuance and at every authenticated call. */
export function toAuthenticatedIdentity(
  user: IdentityUser,
  sessionId: UUID,
): AuthenticatedIdentity {
  const organization = user.organizationMemberships[0] ?? null;
  const roles = new Set<string>();
  const permissions = new Set<string>();
  const allowedSurfaces = new Set<string>();
  user.platformRoleAssignments.forEach((assignment) => {
    roles.add(assignment.role.key);
    assignment.role.permissions.forEach((item) => permissions.add(item));
    assignment.role.allowedSurfaces.forEach((item) =>
      allowedSurfaces.add(item),
    );
  });
  if (organization) {
    roles.add(organization.role.key);
    const accessPermissions = organization.usesCustomAccess
      ? organization.customPermissions
      : organization.role.permissions;
    const accessSurfaces = organization.usesCustomAccess
      ? organization.customAllowedSurfaces
      : organization.role.allowedSurfaces;
    accessPermissions.forEach((item) => permissions.add(item));
    accessSurfaces.forEach((item) => allowedSurfaces.add(item));
  }
  if (user.isOrganizationOwner) {
    // Runtime compatibility only. OWNER no longer persists this wildcard.
    permissions.add('*');
    ['WEB', 'MOBILE', 'API'].forEach((item) => allowedSurfaces.add(item));
  }
  const unitIds = user.effectiveBusinessUnitIds;
  return {
    id: user.id as UUID,
    sessionId,
    organizationId: (organization?.organizationId as UUID) ?? null,
    businessUnitId: (unitIds[0] as UUID) ?? null,
    businessUnitIds: unitIds.map((unit) => unit as UUID),
    roles: [...roles],
    permissions: [...permissions],
    allowedSurfaces: [...allowedSurfaces],
    isOrganizationOwner: user.isOrganizationOwner,
  };
}

@Injectable()
export class AuthenticationService {
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly LOCK_MINUTES = 15;

  constructor(
    private readonly repository: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    private readonly mfa: MfaService,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    @Inject(UUID_PROVIDER) private readonly uuids: IUuidProvider,
  ) {}

  async login(
    email: string,
    password: string,
    mfaCode: string | undefined,
    metadata: SessionMetadata,
  ): Promise<TokenPair> {
    const user = await this.repository.findByEmail(email);
    if (!user?.credential || user.deletedAt || user.status !== 'ACTIVE') {
      /* Mesma recusa para e-mail que não existe e conta desativada: a diferença
         entre as duas só interessa a quem está sondando endereços. */
      throw new UnauthorizedException(
        'Invalid credentials',
        'INVALID_CREDENTIALS',
      );
    }
    if (
      user.credential.lockedUntil &&
      user.credential.lockedUntil.getTime() > Date.now()
    ) {
      throw new UnauthorizedException(
        'Account temporarily locked',
        'ACCOUNT_LOCKED',
      );
    }
    const passwordValid = await this.hashes.verify(
      user.credential.passwordHash,
      password,
    );
    if (!passwordValid) {
      await this.recordFailedAttempt(user);
      throw new UnauthorizedException(
        'Invalid credentials',
        'INVALID_CREDENTIALS',
      );
    }
    const factor = user.mfaFactors[0];
    if (factor) await this.mfa.verifyFactor(factor, mfaCode);

    /**
     * A superfície, depois da senha e do segundo fator.
     *
     * Nesta ordem de propósito: recusar antes de conferir a credencial diria a
     * quem tentasse que aquele endereço existe e é de campo. Quem chega aqui já
     * provou quem é — a recusa passa a ser sobre **onde**, e pode explicar.
     */
    if (!allowsSurface(user, metadata.client)) {
      throw new SurfaceNotAllowedException(normalizeSurface(metadata.client));
    }

    const sessionId = this.uuids.generate();
    const identity = toAuthenticatedIdentity(user, sessionId);
    const pair = await this.tokens.issue(identity);
    await this.repository.createSession({
      id: sessionId,
      userId: user.id,
      organizationId: identity.organizationId,
      businessUnitId: identity.businessUnitId,
      refreshTokenHash: pair.refreshTokenHash,
      expiresAt: pair.expiresAt,
      ...metadata,
    });
    await this.repository.markAuthenticated(user.id, user.credential.id);
    return {
      ...this.publicPair(pair),
      mustChangePassword: user.credential.mustChangePassword,
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = this.tokens.hashOpaqueToken(refreshToken);
    const session = await this.repository.findSessionByRefreshHash(hash);
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.repository.findById(session.userId);
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      await this.repository.revokeSession(session.id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    /**
     * A superfície é reconferida a cada renovação, e a sessão morre se mudou.
     *
     * Só barrar o login deixaria de pé tudo o que já foi emitido: a sessão web
     * de um técnico criada antes desta regra seguiria se renovando por dias. E
     * o mesmo vale quando o dono muda o papel de alguém — a mudança tem de
     * alcançar quem já está dentro, não só a próxima entrada.
     */
    if (!allowsSurface(user, session.client)) {
      await this.repository.revokeSession(session.id);
      throw new SurfaceNotAllowedException(normalizeSurface(session.client));
    }
    const pair = await this.tokens.issue(
      toAuthenticatedIdentity(user, session.id as UUID),
    );
    await this.repository.rotateSession(
      session.id,
      pair.refreshTokenHash,
      pair.expiresAt,
    );
    return this.publicPair(pair);
  }

  async logout(sessionId: string | undefined, refreshToken?: string) {
    if (sessionId) {
      await this.repository.revokeSession(sessionId);
    } else if (refreshToken) {
      const session = await this.repository.findSessionByRefreshHash(
        this.tokens.hashOpaqueToken(refreshToken),
      );
      if (session) await this.repository.revokeSession(session.id);
    }
  }

  listSessions(userId: string) {
    return this.repository.listSessions(userId);
  }

  revokeSession(userId: string, sessionId: string): Promise<void> {
    return this.repository.findSessionById(sessionId).then(async (session) => {
      if (!session || session.userId !== userId) {
        throw new UnauthorizedException();
      }
      await this.repository.revokeSession(sessionId);
    });
  }

  private async recordFailedAttempt(user: IdentityUser): Promise<void> {
    const attempts = user.credential!.failedAttempts + 1;
    const lockedUntil =
      attempts >= AuthenticationService.MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + AuthenticationService.LOCK_MINUTES * 60_000)
        : null;
    await this.repository.updateFailedLogin(
      user.credential!.id,
      attempts,
      lockedUntil,
    );
  }

  private publicPair(
    pair: TokenPair & { refreshTokenHash: string; expiresAt: Date },
  ): TokenPair {
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      tokenType: pair.tokenType,
      expiresIn: pair.expiresIn,
    };
  }
}
