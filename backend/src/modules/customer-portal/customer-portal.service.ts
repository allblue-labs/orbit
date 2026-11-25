import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IHashProvider, IUuidProvider, UUID } from '../../contracts';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  RateLimitException,
  UnauthorizedException,
  ValidationException,
} from '../../exceptions';
import { generateTemporaryPassword } from '../organizations/team/temporary-password';
import {
  composeAccessEmail,
  organizationEmailDomain,
  suggestCustomerLocalPart,
} from './customer-portal-access-email';
import { HASH_PROVIDER, UUID_PROVIDER } from '../../providers';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import type {
  ActivatePortalInvitationDto,
  ChangePortalPasswordDto,
  ConfirmPortalPasswordResetDto,
  CreateCustomerPortalAccessDto,
  InviteCustomerPortalIdentityDto,
  PortalLoginDto,
  RequestPortalPasswordResetDto,
} from './customer-portal.dto';
import { CustomerPortalEmail } from './customer-portal-email';
import { CustomerPortalMapper } from './customer-portal.mapper';
import { CustomerPortalMetrics } from './customer-portal.metrics';
import type {
  CustomerPortalAccessCredentialsReadModel,
  CustomerPortalAccessReadModel,
  CustomerPortalMeReadModel,
  CustomerPortalSessionReadModel,
} from './customer-portal.read-models';
import { CustomerPortalRepository } from './customer-portal.repository';
import { CustomerPortalTokenService } from './customer-portal-token.service';
import {
  CUSTOMER_PORTAL_TOKEN_DELIVERY,
  type CustomerPortalActor,
  type CustomerPortalTokenDelivery,
  type PortalIdentityRecord,
  type PortalSessionRecord,
} from './customer-portal.types';

export interface PortalRequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class CustomerPortalService {
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly repository: CustomerPortalRepository,
    private readonly tokens: CustomerPortalTokenService,
    private readonly mapper: CustomerPortalMapper,
    private readonly metrics: CustomerPortalMetrics,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    @Inject(UUID_PROVIDER) private readonly uuids: IUuidProvider,
    @Inject(CUSTOMER_PORTAL_TOKEN_DELIVERY)
    private readonly delivery: CustomerPortalTokenDelivery,
  ) {
    this.dummyHash = this.hashes.hash('orbit-portal-nonexistent-credential');
  }

  async login(
    input: PortalLoginDto,
    metadata: PortalRequestMetadata,
  ): Promise<CustomerPortalSessionReadModel> {
    this.metrics.increment('login.attempt');
    const slug = input.organizationSlug?.trim().toLocaleLowerCase('en-US');
    await this.rateLimit(
      'LOGIN',
      `${slug ?? ''}:${input.email}:${metadata.ipAddress ?? ''}`,
      5,
    );
    const normalizedEmail = CustomerPortalEmail.normalize(input.email);
    const identity = slug
      ? await this.repository.findLoginIdentity(slug, normalizedEmail)
      : await this.repository.findLoginIdentityByEmail(normalizedEmail);
    const passwordMatches = await this.hashes.verify(
      identity?.passwordHash ?? (await this.dummyHash),
      input.password,
    );
    if (!identity || !passwordMatches || !this.isEligible(identity)) {
      if (identity) await this.repository.recordFailedLogin(identity.id);
      this.metrics.increment('login.failure');
      throw this.invalidCredentials();
    }
    if (identity.lockedUntil && identity.lockedUntil.getTime() > Date.now()) {
      this.metrics.increment('login.failure');
      throw this.invalidCredentials();
    }
    const response = await this.openSession(identity, metadata);
    this.metrics.increment('login.success');
    this.metrics.increment('session.active');
    return response;
  }

  /**
   * Sessão para quem a biometria já identificou: as mesmas recusas do login
   * com senha — cliente, organização e acesso ativos, sem bloqueio.
   */
  async openVerifiedSession(
    identityId: string,
    metadata: PortalRequestMetadata,
  ): Promise<CustomerPortalSessionReadModel> {
    const identity = await this.repository.findLoginIdentityById(identityId);
    if (
      !identity ||
      !this.isEligible(identity) ||
      (identity.lockedUntil && identity.lockedUntil.getTime() > Date.now())
    ) {
      this.metrics.increment('login.failure');
      throw this.invalidCredentials();
    }
    const response = await this.openSession(identity, metadata);
    this.metrics.increment('login.success');
    this.metrics.increment('session.active');
    return response;
  }

  async refresh(refreshToken: string): Promise<CustomerPortalSessionReadModel> {
    const currentHash = this.tokens.hashOpaqueToken(refreshToken);
    const session = await this.repository.findSessionByRefreshHash(currentHash);
    if (!session || !this.isEligible(session)) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const pair = await this.tokens.issue(this.actor(session));
    const rotated = await this.repository.rotateSession(
      session.sessionId,
      currentHash,
      pair.refreshTokenHash,
      pair.expiresAt,
    );
    if (!rotated) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      tokenType: pair.tokenType,
      expiresIn: pair.expiresIn,
      me: await this.meOf(session),
    };
  }

  async logout(actor: CustomerPortalActor): Promise<void> {
    await this.repository.revokeSession(actor.sessionId, actor.identityId);
  }

  async me(actor: CustomerPortalActor): Promise<CustomerPortalMeReadModel> {
    const session = await this.repository.resolveSession(
      actor.sessionId,
      actor.identityId,
    );
    if (!session) throw new UnauthorizedException();
    return this.meOf(session);
  }

  /** O `me` com o que só o estado do perfil sabe: a troca de senha pendente. */
  private async meOf(
    session: PortalSessionRecord,
  ): Promise<CustomerPortalMeReadModel> {
    const state = await this.repository.profileState(
      session.id,
      session.sessionId,
    );
    return this.mapper.me(session, state?.mustChangePassword ?? false);
  }

  /** Convite e recuperação dependem de e-mail; sem entrega real, recusam. */
  private requireEmailDelivery(): void {
    if (this.delivery.connected === false) {
      throw new ConflictException(
        'O envio de e-mail do portal não está disponível. O acesso do cliente é criado pelo responsável, com senha temporária.',
        'PORTAL_EMAIL_DELIVERY_UNAVAILABLE',
      );
    }
  }

  async activate(
    input: ActivatePortalInvitationDto,
    metadata: PortalRequestMetadata,
  ): Promise<CustomerPortalSessionReadModel> {
    this.requireEmailDelivery();
    const tokenHash = this.tokens.hashOpaqueToken(input.token);
    await this.rateLimit(
      'ACTIVATE',
      `${tokenHash}:${metadata.ipAddress ?? ''}`,
      8,
    );
    const identity = await this.repository.activateInvitation(
      tokenHash,
      await this.hashes.hash(input.password),
    );
    if (!identity) {
      throw new ConflictException(
        'Invitation is invalid or expired',
        'PORTAL_INVITATION_INVALID',
      );
    }
    this.metrics.increment('invite.activation');
    return this.openSession(identity, metadata);
  }

  async requestPasswordReset(
    input: RequestPortalPasswordResetDto,
    metadata: PortalRequestMetadata,
  ): Promise<void> {
    this.requireEmailDelivery();
    const email = CustomerPortalEmail.normalize(input.email);
    const slug = input.organizationSlug.trim().toLocaleLowerCase('en-US');
    await this.rateLimit(
      'RESET_REQUEST',
      `${slug}:${email}:${metadata.ipAddress ?? ''}`,
      5,
    );
    const token = this.tokens.generateOpaqueToken();
    const created = await this.repository.createPasswordReset(
      slug,
      email,
      this.uuids.generate(),
      this.tokens.hashOpaqueToken(token),
      new Date(Date.now() + 60 * 60 * 1_000),
    );
    if (created) {
      await this.delivery.deliver('PASSWORD_RESET', input.email, token);
    }
  }

  async confirmPasswordReset(
    input: ConfirmPortalPasswordResetDto,
    metadata: PortalRequestMetadata,
  ): Promise<void> {
    this.requireEmailDelivery();
    const tokenHash = this.tokens.hashOpaqueToken(input.token);
    await this.rateLimit(
      'RESET_CONFIRM',
      `${tokenHash}:${metadata.ipAddress ?? ''}`,
      8,
    );
    const consumed = await this.repository.consumePasswordReset(
      tokenHash,
      await this.hashes.hash(input.password),
    );
    if (!consumed) {
      throw new ConflictException(
        'Reset token is invalid or expired',
        'PORTAL_RESET_INVALID',
      );
    }
    this.metrics.increment('password.reset');
  }

  async changePassword(
    actor: CustomerPortalActor,
    input: ChangePortalPasswordDto,
  ): Promise<void> {
    const session = await this.repository.resolveSession(
      actor.sessionId,
      actor.identityId,
    );
    if (
      !session?.passwordHash ||
      !(await this.hashes.verify(session.passwordHash, input.currentPassword))
    ) {
      throw this.invalidCredentials();
    }
    const changed = await this.repository.changePassword(
      actor.identityId,
      actor.sessionId,
      await this.hashes.hash(input.newPassword),
    );
    if (!changed) throw new UnauthorizedException();
  }

  async confirmSecurityChange(
    actor: CustomerPortalActor,
    password: string,
  ): Promise<void> {
    const session = await this.repository.resolveSession(
      actor.sessionId,
      actor.identityId,
    );
    if (
      !session?.passwordHash ||
      !(await this.hashes.verify(session.passwordHash, password))
    )
      throw new ForbiddenException(
        'A senha atual não pôde ser confirmada.',
        'SECURITY_PASSWORD_INVALID',
      );
    const profile = await this.repository.profileState(
      actor.identityId,
      actor.sessionId,
    );
    if (!profile || profile.mustChangePassword)
      throw new ForbiddenException(
        'Confirme sua identidade para concluir esta ação.',
        'SECURITY_CONFIRMATION_REQUIRED',
      );
  }

  async invite(
    customerId: string,
    request: IdentityRequest,
    input: InviteCustomerPortalIdentityDto,
  ) {
    this.requireEmailDelivery();
    const actor = this.internalActor(request);
    const token = this.tokens.generateOpaqueToken();
    const invitation = await this.repository.invite({
      organizationId: actor.organizationId,
      customerId,
      contactId: input.contactId,
      invitedById: actor.id,
      email: input.email.trim(),
      normalizedEmail: CustomerPortalEmail.normalize(input.email),
      displayName: input.displayName.trim(),
      invitationId: this.uuids.generate(),
      identityId: this.uuids.generate(),
      tokenHash: this.tokens.hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1_000),
    });
    await this.delivery.deliver('INVITATION', input.email, token);
    return this.mapper.invitation(invitation);
  }

  /* ---------------------------------------------------------------- */
  /* Acesso criado pelo owner                                          */
  /* ---------------------------------------------------------------- */

  async access(
    customerId: string,
    request: IdentityRequest,
  ): Promise<CustomerPortalAccessReadModel> {
    const actor = this.internalActor(request);
    const context = await this.repository.accessContext(
      actor.organizationId,
      customerId,
    );
    if (!context) throw new EntityNotFoundException('Customer', customerId);
    return {
      domain: organizationEmailDomain(context.slug),
      suggestedLocalPart: suggestCustomerLocalPart(context.customerName),
      identity: context.identity ? this.mapper.access(context.identity) : null,
    };
  }

  /**
   * Cria o acesso e devolve a senha temporária **uma vez**. Nada a guarda em
   * claro: perdeu, o owner gera outra.
   */
  async createAccess(
    customerId: string,
    request: IdentityRequest,
    input: CreateCustomerPortalAccessDto,
  ): Promise<CustomerPortalAccessCredentialsReadModel> {
    const actor = this.internalActor(request);
    const context = await this.repository.accessContext(
      actor.organizationId,
      customerId,
    );
    if (!context) throw new EntityNotFoundException('Customer', customerId);
    const email = composeAccessEmail(input.localPart, context.slug);
    if (!email) {
      throw new ValidationException(
        'Informe um nome de acesso com letras ou números.',
        undefined,
        'PORTAL_ACCESS_LOCAL_PART_INVALID',
      );
    }
    const temporaryPassword = generateTemporaryPassword();
    const identity = await this.repository.createAccess({
      organizationId: actor.organizationId,
      customerId,
      actorId: actor.id,
      identityId: this.uuids.generate(),
      email,
      normalizedEmail: CustomerPortalEmail.normalize(email),
      displayName: input.displayName?.trim() || context.customerName,
      passwordHash: await this.hashes.hash(temporaryPassword),
    });
    this.metrics.increment('access.created');
    return { identity: this.mapper.access(identity), temporaryPassword };
  }

  async resetAccessPassword(
    customerId: string,
    identityId: string,
    request: IdentityRequest,
  ): Promise<CustomerPortalAccessCredentialsReadModel> {
    const actor = this.internalActor(request);
    const temporaryPassword = generateTemporaryPassword();
    const identity = await this.repository.resetAccessPassword({
      organizationId: actor.organizationId,
      customerId,
      identityId,
      actorId: actor.id,
      passwordHash: await this.hashes.hash(temporaryPassword),
    });
    if (!identity) {
      throw new EntityNotFoundException('Customer portal identity', identityId);
    }
    this.metrics.increment('access.password_reset');
    return { identity: this.mapper.access(identity), temporaryPassword };
  }

  async disable(
    customerId: string,
    identityId: string,
    request: IdentityRequest,
  ): Promise<void> {
    const actor = this.internalActor(request);
    if (
      !(await this.repository.disable(
        actor.organizationId,
        customerId,
        identityId,
        actor.id,
      ))
    ) {
      throw new EntityNotFoundException('Customer portal identity', identityId);
    }
  }

  async revokeSessions(
    customerId: string,
    identityId: string,
    request: IdentityRequest,
  ): Promise<{ revokedSessions: number }> {
    const actor = this.internalActor(request);
    const revokedSessions = await this.repository.revokeSessions(
      actor.organizationId,
      customerId,
      identityId,
      actor.id,
    );
    if (revokedSessions === 0) {
      const exists = await this.repository.identityExists(
        actor.organizationId,
        customerId,
        identityId,
      );
      if (!exists)
        throw new EntityNotFoundException(
          'Customer portal identity',
          identityId,
        );
    }
    return { revokedSessions };
  }

  private async openSession(
    identity: PortalIdentityRecord,
    metadata: PortalRequestMetadata,
  ): Promise<CustomerPortalSessionReadModel> {
    const sessionId = this.uuids.generate();
    const actor: CustomerPortalActor = {
      actorType: 'CUSTOMER_PORTAL',
      identityId: identity.id as UUID,
      sessionId,
      organizationId: identity.organizationId as UUID,
      customerId: identity.customerId as UUID,
    };
    const pair = await this.tokens.issue(actor);
    const session = await this.repository.createSession({
      id: sessionId,
      identityId: identity.id,
      refreshTokenHash: pair.refreshTokenHash,
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
      expiresAt: pair.expiresAt,
    });
    return {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      tokenType: pair.tokenType,
      expiresIn: pair.expiresIn,
      me: await this.meOf(session),
    };
  }

  private actor(record: PortalSessionRecord): CustomerPortalActor {
    return {
      actorType: 'CUSTOMER_PORTAL',
      identityId: record.id as UUID,
      sessionId: record.sessionId as UUID,
      organizationId: record.organizationId as UUID,
      customerId: record.customerId as UUID,
    };
  }

  private isEligible(identity: PortalIdentityRecord): boolean {
    return (
      identity.status === 'ACTIVE' &&
      identity.disabledAt === null &&
      identity.organizationStatus === 'ACTIVE' &&
      identity.organizationDeletedAt === null &&
      identity.customerStatus === 'ACTIVE' &&
      identity.customerDeletedAt === null &&
      Boolean(identity.passwordHash)
    );
  }

  private async rateLimit(
    action: string,
    scope: string,
    limit: number,
  ): Promise<void> {
    const scopeHash = createHash('sha256').update(scope).digest('hex');
    const result = await this.repository.consumeRateLimit(
      action,
      scopeHash,
      limit,
      15 * 60,
      15 * 60,
    );
    if (!result.allowed) {
      throw new RateLimitException(result.retryAfterSeconds);
    }
  }

  private invalidCredentials(): UnauthorizedException {
    return new UnauthorizedException('Invalid credentials');
  }

  private internalActor(request: IdentityRequest): {
    id: string;
    organizationId: string;
  } {
    if (!request.identity?.organizationId) {
      throw new UnauthorizedException();
    }
    return {
      id: request.identity.id,
      organizationId: request.identity.organizationId,
    };
  }
}
