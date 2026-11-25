import { Inject, Injectable } from '@nestjs/common';
import type {
  ICryptoProvider,
  IHashProvider,
  IUuidProvider,
  UUID,
} from '../../../contracts';
import {
  CRYPTO_PROVIDER,
  HASH_PROVIDER,
  UUID_PROVIDER,
} from '../../../providers';
import {
  BaseException,
  ForbiddenException,
  UnauthorizedException,
} from '../../../exceptions';
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
import { VerifiedPlatformAuthority } from '../../../common/verified-platform-authority';
import {
  isPlatformPermission,
  isReservedRoleKey,
} from '../../../common/role-namespace';

/** Pure, shared resolution used at issuance and at every authenticated call. */
export function toAuthenticatedIdentity(
  user: IdentityUser,
  sessionId: UUID,
): AuthenticatedIdentity {
  const organization = user.organizationMemberships[0] ?? null;
  const platformAuthority = VerifiedPlatformAuthority.forUser(
    user.platformAuthority,
    user.id,
  );
  const roles = new Set<string>(platformAuthority?.roles ?? []);
  const permissions = new Set<string>(platformAuthority?.permissions ?? []);
  const allowedSurfaces = new Set<string>(
    platformAuthority?.allowedSurfaces ?? [],
  );
  const organizationRoles: string[] = [];
  if (organization) {
    // Conflicting legacy tenant roles retain tenant access, never global power.
    if (!isReservedRoleKey(organization.role.key)) {
      roles.add(organization.role.key);
      organizationRoles.push(organization.role.key);
    }
    const accessPermissions = organization.usesCustomAccess
      ? organization.customPermissions
      : organization.role.permissions;
    const accessSurfaces = organization.usesCustomAccess
      ? organization.customAllowedSurfaces
      : organization.role.allowedSurfaces;
    accessPermissions
      .filter((item) => !isPlatformPermission(item))
      .forEach((item) => permissions.add(item));
    accessSurfaces.forEach((item) => allowedSurfaces.add(item));
  }
  if (user.isOrganizationOwner) {
    // Runtime compatibility only. OWNER no longer persists this wildcard.
    permissions.add('*');
    ['WEB', 'MOBILE', 'API'].forEach((item) => allowedSurfaces.add(item));
  }
  const unitIds = user.effectiveBusinessUnitIds;
  return {
    platformAuthority,
    organizationRoles,
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
  constructor(
    private readonly repository: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    private readonly mfa: MfaService,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    @Inject(UUID_PROVIDER) private readonly uuids: IUuidProvider,
    @Inject(CRYPTO_PROVIDER) private readonly crypto: ICryptoProvider,
  ) {}

  async confirmSecurityChange(
    userId: string,
    password: string,
    mfaCode?: string,
  ): Promise<void> {
    const user = await this.repository.findById(userId);
    if (
      !user?.credential ||
      user.status !== 'ACTIVE' ||
      user.deletedAt ||
      user.requiresEmailVerification ||
      user.credential.mustChangePassword ||
      !(await this.hashes.verify(user.credential.passwordHash, password))
    )
      throw new ForbiddenException(
        'A senha atual não pôde ser confirmada.',
        'SECURITY_PASSWORD_INVALID',
      );
    const factor = user.mfaFactors[0];
    if (!factor) return;
    try {
      await this.mfa.verifyFactor(factor, mfaCode);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
      throw new ForbiddenException(
        'Informe um código válido do aplicativo autenticador.',
        'SECURITY_MFA_INVALID',
      );
    }
  }

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
    if (factor) {
      try {
        await this.mfa.verifyFactor(factor, mfaCode);
      } catch (error) {
        if (error instanceof BaseException && error.code === 'MFA_INVALID')
          await this.recordFailedAttempt(user);
        throw error;
      }
    }

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

    if (user.requiresEmailVerification)
      throw new UnauthorizedException(
        'Confirme seu e-mail antes de entrar.',
        'EMAIL_VERIFICATION_REQUIRED',
      );

    const sessionId = this.uuids.generate();
    const identity = toAuthenticatedIdentity(user, sessionId);
    const pair = await this.tokens.issue(identity);
    await this.repository.completeLogin(
      {
        id: sessionId,
        userId: user.id,
        organizationId: identity.organizationId,
        businessUnitId: identity.businessUnitId,
        refreshTokenHash: pair.refreshTokenHash,
        expiresAt: pair.expiresAt,
        ...metadata,
      },
      user.credential.id,
      user.credential.passwordHash,
    );
    return {
      ...this.publicPair(pair),
      mustChangePassword: user.credential.mustChangePassword,
    };
  }

  /**
   * Sessão para quem já provou quem é por outro meio — a biometria.
   *
   * As mesmas portas do login com senha, menos a senha: conta ativa,
   * superfície permitida, e-mail confirmado. Bloqueio por tentativas de senha
   * também vale — a biometria não é atalho para fugir dele — e senha
   * temporária pendente recusa: quem recebeu uma senha nova entra com ela.
   */
  async openVerifiedSession(
    userId: string,
    metadata: SessionMetadata,
  ): Promise<TokenPair> {
    const user = await this.repository.findById(userId);
    if (
      !user?.credential ||
      user.deletedAt ||
      user.status !== 'ACTIVE' ||
      user.credential.mustChangePassword
    )
      throw new UnauthorizedException(
        'Invalid credentials',
        'INVALID_CREDENTIALS',
      );
    if (
      user.credential.lockedUntil &&
      user.credential.lockedUntil.getTime() > Date.now()
    )
      throw new UnauthorizedException(
        'Account temporarily locked',
        'ACCOUNT_LOCKED',
      );
    if (!allowsSurface(user, metadata.client))
      throw new SurfaceNotAllowedException(normalizeSurface(metadata.client));
    if (user.requiresEmailVerification)
      throw new UnauthorizedException(
        'Confirme seu e-mail antes de entrar.',
        'EMAIL_VERIFICATION_REQUIRED',
      );
    const sessionId = this.uuids.generate();
    const identity = toAuthenticatedIdentity(user, sessionId);
    const pair = await this.tokens.issue(identity);
    await this.repository.openSession({
      id: sessionId,
      userId: user.id,
      organizationId: identity.organizationId,
      businessUnitId: identity.businessUnitId,
      refreshTokenHash: pair.refreshTokenHash,
      expiresAt: pair.expiresAt,
      ...metadata,
    });
    return { ...this.publicPair(pair), mustChangePassword: false };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = this.tokens.hashOpaqueToken(refreshToken);
    // One CAS winner. A competing replica rereads the canonical encrypted pair,
    // rather than publishing the unused pair it happened to generate.
    for (let attempt = 0; attempt < 2; attempt++) {
      const session = await this.repository.findRefreshSession(hash);
      if (!session) throw new UnauthorizedException('Invalid refresh token');
      const user = await this.repository.findById(session.userId);
      if (!user || user.deletedAt || user.status !== 'ACTIVE') {
        await this.repository.revokeSession(session.id, session.userId);
        throw new UnauthorizedException('Invalid refresh token');
      }
      if (user.requiresEmailVerification) {
        await this.repository.revokeSession(session.id, session.userId);
        throw new UnauthorizedException(
          'Confirme seu e-mail antes de entrar.',
          'EMAIL_VERIFICATION_REQUIRED',
        );
      }
      if (!allowsSurface(user, session.client)) {
        await this.repository.revokeSession(session.id, session.userId);
        throw new SurfaceNotAllowedException(normalizeSurface(session.client));
      }
      if (session.inGrace && session.rotationResponse) {
        try {
          const pair = JSON.parse(
            this.crypto.decrypt(session.rotationResponse),
          ) as TokenPair;
          if (
            typeof pair.accessToken !== 'string' ||
            typeof pair.refreshToken !== 'string' ||
            pair.tokenType !== 'Bearer' ||
            !Number.isFinite(pair.expiresIn) ||
            pair.expiresIn <= 0 ||
            this.tokens.hashOpaqueToken(pair.refreshToken) !==
              session.refreshTokenHash
          )
            throw new Error('Invalid rotation response');
          return pair;
        } catch {
          await this.repository.revokeSession(session.id, session.userId);
          throw new UnauthorizedException('Invalid refresh token');
        }
      }
      if (session.refreshTokenHash !== hash) {
        // Confirmed reuse of the previous generation after the fixed grace.
        await this.repository.revokeSession(session.id, session.userId);
        throw new UnauthorizedException('Invalid refresh token');
      }
      const pair = await this.tokens.issue(
        toAuthenticatedIdentity(user, session.id as UUID),
      );
      const publicPair = this.publicPair(pair);
      if (
        await this.repository.rotateSession(
          session.id,
          hash,
          pair.refreshTokenHash,
          pair.expiresAt,
          this.crypto.encrypt(JSON.stringify(publicPair)),
          session.userId,
        )
      )
        return publicPair;
    }
    throw new UnauthorizedException('Invalid refresh token');
  }

  async logout(
    sessionId: string | undefined,
    refreshToken?: string,
    userId?: string,
  ) {
    if (sessionId && userId) {
      await this.repository.revokeSession(sessionId, userId);
    } else if (refreshToken) {
      const session = await this.repository.findSessionByRefreshHash(
        this.tokens.hashOpaqueToken(refreshToken),
      );
      if (session)
        await this.repository.revokeSession(session.id, session.userId);
    }
  }

  listSessions(userId: string) {
    return this.repository.listSessions(userId);
  }

  revokeSession(userId: string, sessionId: string): Promise<void> {
    return this.repository
      .findSessionById(sessionId, userId)
      .then(async (session) => {
        if (!session || session.userId !== userId) {
          throw new UnauthorizedException();
        }
        await this.repository.revokeSession(sessionId, userId);
      });
  }

  private async recordFailedAttempt(user: IdentityUser): Promise<void> {
    await this.repository.updateFailedLogin(
      user.credential!.id,
      user.credential!.passwordHash,
      user.id,
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
