import { Inject, Injectable } from '@nestjs/common';
import type { IHashProvider } from '../../../contracts';
import { HASH_PROVIDER } from '../../../providers';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../../exceptions';
import {
  IDENTITY_TOKEN_DELIVERY,
  IdentityTokenPurpose,
  type IIdentityTokenDelivery,
} from '../domain/identity.types';
import {
  AllocationResource,
  EntitlementService,
} from '../../subscription-plans/entitlements';
import { IdentityRepository } from '../infrastructure/identity.repository';
import { IdentityTokenService } from './token.service';
import { AuthorizationService } from '../../../common';
import { ForbiddenException } from '../../../exceptions';

@Injectable()
export class InvitationService {
  constructor(
    private readonly repository: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    @Inject(IDENTITY_TOKEN_DELIVERY)
    private readonly delivery: IIdentityTokenDelivery,
    private readonly entitlements: EntitlementService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(input: {
    organizationId: string;
    businessUnitId?: string;
    roleId: string;
    invitedById: string;
    email: string;
    actorPermissions: readonly string[];
    actorSurfaces: readonly string[];
    actorUnitIds: readonly string[];
    isOrganizationOwner: boolean;
  }): Promise<{ id: string; expiresAt: Date }> {
    /**
     * Aviso antecipado, não a autoridade.
     *
     * A vaga só é de fato ocupada quando alguém aceita, e é lá que o teto é
     * aplicado sob bloqueio. Conferir aqui existe para que a recusa apareça
     * para quem convida, e não para o convidado no meio do cadastro.
     */
    await this.entitlements.assertCanAllocate(
      input.organizationId,
      AllocationResource.PLATFORM_USERS,
    );
    const role = await this.repository.findDelegatedRole(
      input.organizationId,
      input.roleId,
      input.invitedById,
      input.actorUnitIds,
    );
    if (!role || role.key === 'OWNER' || role.permissions.includes('*'))
      throw new ValidationException('Invalid role');
    if (
      !this.authorization.canDelegate(
        {
          permissions: input.actorPermissions,
          allowedSurfaces: input.actorSurfaces,
          isOrganizationOwner: input.isOrganizationOwner,
        },
        role.permissions,
        role.allowedSurfaces,
      )
    )
      throw new ForbiddenException(
        'Access cannot exceed the current actor authority',
      );
    if (
      input.businessUnitId &&
      !this.authorization.canAccessUnit(
        {
          businessUnitIds: input.actorUnitIds,
          isOrganizationOwner: input.isOrganizationOwner,
        },
        input.businessUnitId,
      )
    )
      throw new ForbiddenException('Business unit is outside actor scope');
    const token = this.tokens.generateOpaqueToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    let invitation: Awaited<ReturnType<IdentityRepository['createInvitation']>>;
    try {
      invitation = await this.repository.createInvitation({
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        roleId: input.roleId,
        invitedById: input.invitedById,
        email: input.email.trim(),
        normalizedEmail: input.email.trim().toLowerCase(),
        tokenHash: this.tokens.hashOpaqueToken(token),
        expiresAt,
      });
    } catch {
      throw new ConflictException('A pending invitation already exists');
    }
    await this.delivery.deliver(
      IdentityTokenPurpose.INVITATION,
      invitation.email,
      token,
    );
    return { id: invitation.id, expiresAt };
  }

  /**
   * Convites da organização.
   *
   * O **token nunca é publicado** — nem o valor, nem o hash. Ele é entregue
   * uma vez, por e-mail, no ato do convite; reexpô-lo numa listagem daria a
   * qualquer gestor a capacidade de entrar como o convidado.
   *
   * Reenviar gera um token novo, e é por isso que o antigo deixa de valer.
   */
  list(
    organizationId: string,
    query: { status?: string; search?: string; page: number; limit: number },
  ) {
    return this.repository.listInvitations(organizationId, {
      status: query.status,
      search: query.search,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
  }

  /**
   * Reenvia um convite pendente.
   *
   * Gera **token novo** e prazo novo: o link anterior deixa de funcionar. É o
   * comportamento seguro — se o convite foi reenviado, foi porque o primeiro
   * não chegou ou não devia mais valer.
   */
  async resend(
    id: string,
    organizationId: string,
  ): Promise<{ id: string; expiresAt: Date }> {
    const invitation = await this.requirePending(id, organizationId);
    const token = this.tokens.generateOpaqueToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);

    await this.repository.refreshInvitation(invitation.id, organizationId, {
      tokenHash: this.tokens.hashOpaqueToken(token),
      expiresAt,
    });
    await this.delivery.deliver(
      IdentityTokenPurpose.INVITATION,
      invitation.email,
      token,
    );
    return { id: invitation.id, expiresAt };
  }

  async revoke(id: string, organizationId: string): Promise<void> {
    await this.requirePending(id, organizationId);
    await this.repository.revokeInvitation(id, organizationId);
  }

  /**
   * Só convite pendente aceita reenvio ou cancelamento.
   *
   * Um convite aceito virou membro; um cancelado já não vale; um expirado
   * precisa de outro convite. Reabri-los seria mudar o passado.
   */
  private async requirePending(id: string, organizationId: string) {
    const invitation = await this.repository.findInvitationById(
      id,
      organizationId,
    );
    if (!invitation) throw new EntityNotFoundException('Invitation', id);
    if (invitation.status !== 'PENDING') {
      throw new ValidationException(
        `Invitation is ${invitation.status.toLowerCase()} and cannot be changed`,
      );
    }
    return invitation;
  }

  async accept(input: {
    token: string;
    firstName: string;
    lastName: string;
    password: string;
  }): Promise<void> {
    const invitation = await this.repository.findInvitation(
      this.tokens.hashOpaqueToken(input.token),
    );
    if (
      !invitation ||
      invitation.status !== 'PENDING' ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new ValidationException('Invalid or expired invitation');
    }
    await this.repository.acceptInvitation(
      invitation.id,
      {
        email: invitation.email,
        normalizedEmail: invitation.normalizedEmail,
        firstName: input.firstName,
        lastName: input.lastName,
        passwordHash: await this.hashes.hash(input.password),
        organizationId: invitation.organizationId,
        businessUnitId: invitation.businessUnitId,
        roleId: invitation.roleId,
      },
      (transaction) =>
        this.entitlements.enforceAllocationIn(
          transaction,
          invitation.organizationId,
          AllocationResource.PLATFORM_USERS,
        ),
    );
  }
}
