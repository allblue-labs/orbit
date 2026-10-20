import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IHashProvider } from '../../../contracts';
import { HASH_PROVIDER } from '../../../providers';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../../exceptions';
import { identityTokenLink } from '../../identity/domain/identity-links';
import {
  IDENTITY_TOKEN_DELIVERY,
  IdentityTokenPurpose,
  type IIdentityTokenDelivery,
} from '../../identity/domain/identity.types';
import { IdentityRepository } from '../../identity/infrastructure/identity.repository';
import { IdentityTokenService } from '../../identity/application/token.service';
import {
  AllocationResource,
  EntitlementService,
} from '../../subscription-plans/entitlements';
import { OrganizationRepository } from '../organization.repository';
import { TeamRepository } from './team.repository';
import { generateTemporaryPassword } from './temporary-password';
import { AuthorizationService } from '../../../common';
import { isKnownPermission, ROLE_SURFACES } from '../team-roles';
import { executesFieldWork } from '../../workforce/field-eligibility';

/** Quanto tempo o link de definição de senha vale. */
const VALIDADE_DO_LINK_MS = 24 * 60 * 60_000;

export interface TeamActor {
  organizationId: string;
  userId: string;
  permissions: readonly string[];
  allowedSurfaces: readonly string[];
  businessUnitIds: readonly string[];
  isOrganizationOwner: boolean;
}

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly team: TeamRepository,
    private readonly organizations: OrganizationRepository,
    private readonly identity: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    private readonly entitlements: EntitlementService,
    private readonly authorization: AuthorizationService,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    @Inject(IDENTITY_TOKEN_DELIVERY)
    private readonly delivery: IIdentityTokenDelivery,
  ) {}

  /**
   * Cadastra alguém da equipe e devolve a senha temporária **uma vez**.
   *
   * ## Por que cadastro direto, e não convite
   *
   * O convite pressupõe que a pessoa tem e-mail, lê e-mail, e consegue concluir
   * um cadastro sozinha. Boa parte de uma equipe de campo não atende às três, e
   * o resultado prático era o owner não conseguir colocar o próprio técnico no
   * sistema. O convite continua existindo para quem tem e-mail; isto é o outro
   * caminho, não o substituto.
   *
   * ## A senha não fica guardada
   *
   * Ela é gerada, transformada em hash e devolvida na resposta. Não há coluna
   * com ela, e não há segunda chance de lê-la: perdida a resposta, o caminho é
   * gerar um link novo de definição de senha.
   */
  async createMember(
    actor: TeamActor,
    input: {
      email: string;
      firstName: string;
      lastName: string;
      roleId: string;
      businessUnitId?: string;
      businessUnitIds?: string[];
      useRoleDefaults?: boolean;
      permissions?: string[];
      allowedSurfaces?: string[];
    },
  ) {
    const organizacao = await this.organizations.findCurrent(
      actor.organizationId,
    );
    if (!organizacao) throw new EntityNotFoundException('Organization');

    const papel = await this.requireAssignableRole(
      actor.organizationId,
      input.roleId,
    );
    const businessUnitIds = this.requireBusinessUnits(
      input.businessUnitIds ??
        (input.businessUnitId ? [input.businessUnitId] : undefined),
      organizacao.businessUnits,
    );
    if (
      businessUnitIds.some(
        (unitId) => !this.authorization.canAccessUnit(actor, unitId),
      )
    )
      throw new ForbiddenException('Business unit is outside actor scope');
    const usesCustomAccess =
      input.useRoleDefaults === false ||
      input.permissions !== undefined ||
      input.allowedSurfaces !== undefined;
    const permissions = usesCustomAccess
      ? (input.permissions ?? papel.permissions)
      : papel.permissions;
    const allowedSurfaces = usesCustomAccess
      ? (input.allowedSurfaces ?? papel.allowedSurfaces)
      : papel.allowedSurfaces;
    this.validateAccess(permissions, allowedSurfaces);
    if (!this.authorization.canDelegate(actor, permissions, allowedSurfaces))
      throw new ForbiddenException(
        'Access cannot exceed the current actor authority',
      );

    const senha = generateTemporaryPassword();
    const resultado = await this.team.createMember(
      {
        organizationId: actor.organizationId,
        /**
         * O perfil profissional nasce com o cadastro quando o acesso concedido
         * diz que a pessoa executa em campo.
         *
         * Sem isto, cadastrar um "Técnico operador" não o tornava atribuível:
         * a lista de técnicos do formulário de operação lê
         * `professional_profiles`, e `validateTechnicianAssignments` recusa quem
         * não está lá. O dono cadastrava o técnico, abria a operação e
         * encontrava o seletor vazio — com o passo que faltava escondido na
         * página de outro lugar.
         */
        fieldTechnicianEnabled: executesFieldWork({
          permissions,
          allowedSurfaces,
        }),
        businessUnitIds,
        roleId: papel.id,
        usesCustomAccess,
        customPermissions: usesCustomAccess ? [...permissions] : [],
        customAllowedSurfaces: usesCustomAccess ? [...allowedSurfaces] : [],
        actorId: actor.userId,
        email: input.email.trim(),
        normalizedEmail: input.email.trim().toLowerCase(),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        passwordHash: await this.hashes.hash(senha),
      },
      (transaction) =>
        this.entitlements.enforceAllocationIn(
          transaction,
          actor.organizationId,
          AllocationResource.PLATFORM_USERS,
        ),
    );

    if ('conflict' in resultado) {
      /**
       * Mensagem única para e-mail já usado **em qualquer organização**.
       *
       * Dizer "já existe nesta organização" versus "existe em outra" contaria a
       * quem cadastra onde aquela pessoa já trabalha.
       */
      throw new ConflictException('This e-mail already has an Orbit account');
    }

    const membro = await this.team.findMember(
      actor.organizationId,
      resultado.userId,
    );
    if (!membro) throw new EntityNotFoundException('Member', resultado.userId);
    const unitMemberships = (
      await this.organizations.listBusinessUnitMemberships(actor.organizationId)
    ).filter((item) => item.userId === resultado.userId);

    return { member: membro, temporaryPassword: senha, unitMemberships };
  }

  /**
   * Um link de definição de senha para um membro, visível ao owner.
   *
   * ## Por que devolver o link aqui, e nunca no fluxo público
   *
   * `POST /identity/password/forgot` é anônimo: qualquer um pode chamá-lo com
   * qualquer e-mail, e devolver o link ali seria entregar contas a quem digitar
   * o endereço certo. Aqui quem pede já é quem administra aquela pessoa — pode
   * trocar o papel dela, desligá-la, ver o que ela faz — e passar o link por
   * WhatsApp não lhe dá poder que ele já não tenha.
   *
   * O e-mail também é disparado quando há SMTP: os dois caminhos levam ao mesmo
   * endereço, e o owner usa o que funcionar para aquela pessoa.
   */
  async issuePasswordLink(actor: TeamActor, userId: string) {
    const membro = await this.team.findMember(actor.organizationId, userId);
    if (!membro) throw new EntityNotFoundException('Member', userId);
    await this.assertMemberInActorScope(actor, userId);

    const organizacao = await this.organizations.findCurrent(
      actor.organizationId,
    );
    /**
     * O dono não recebe link por aqui.
     *
     * Quem administrasse a organização poderia gerar um link para a conta do
     * dono e assumir o lugar dele. O dono redefine a própria senha pelo fluxo
     * público, que exige acesso ao e-mail dele.
     */
    if (organizacao?.ownerUserId === userId) {
      throw new ValidationException(
        'The organization owner must use the public password recovery flow',
      );
    }

    const token = this.tokens.generateOpaqueToken();
    const expiresAt = new Date(Date.now() + VALIDADE_DO_LINK_MS);
    await this.identity.createPasswordReset(
      userId,
      this.tokens.hashOpaqueToken(token),
      expiresAt,
    );

    /**
     * O e-mail sai também, e a falha dele não derruba a resposta.
     *
     * O link é o entregável desta rota — o owner o repassa por onde conseguir.
     * Tentar o e-mail é conveniência para quem tem caixa postal; se o SMTP não
     * estiver configurado, o owner ainda tem o link na mão, e `emailSent` diz a
     * ele que precisa usá-lo.
     */
    let emailSent = false;
    try {
      await this.delivery.deliver(
        IdentityTokenPurpose.PASSWORD_RESET,
        membro.user.email,
        token,
      );
      emailSent = true;
    } catch {
      this.logger.warn('Team password link e-mail delivery failed');
    }

    return {
      link: identityTokenLink(IdentityTokenPurpose.PASSWORD_RESET, token),
      expiresAt,
      emailSent,
      member: membro,
    };
  }

  async removeMember(actor: TeamActor, userId: string) {
    const organizacao = await this.organizations.findCurrent(
      actor.organizationId,
    );
    if (organizacao?.ownerUserId === userId) {
      throw new ValidationException(
        'The organization owner cannot be removed from the team',
      );
    }
    if (actor.userId === userId) {
      throw new ValidationException('You cannot remove your own access');
    }
    const membro = await this.team.findMember(actor.organizationId, userId);
    if (!membro) throw new EntityNotFoundException('Member', userId);
    await this.assertMemberInActorScope(actor, userId);

    await this.team.removeMember(actor.organizationId, userId);
  }

  /**
   * O papel precisa existir nesta organização e não conceder tudo.
   *
   * ## A recusa é pela permissão, não pelo nome
   *
   * O que não pode ser concedido aqui é o curinga `*`: quem o recebe passa a
   * poder remover quem o cadastrou, e trocar o comando da conta é decisão de
   * outra ordem — não um campo de formulário.
   *
   * Recusar apenas o papel **chamado** `OWNER` deixaria a porta aberta: a
   * organização pode criar papéis próprios em `POST /organizations/current/roles`,
   * e um deles com `['*']` teria passado por ter outro nome. Checar a permissão
   * fecha o caso que a regra existe para impedir.
   *
   * Papéis sob medida sem curinga continuam atribuíveis — é para isso que o
   * endpoint de papéis existe, e a tela de equipe não tem por que recusá-los.
   * Um papel de outra organização é recusado como inexistente: a FK não conhece
   * inquilino, e `findRole` filtra por ele.
   */
  private async requireAssignableRole(organizationId: string, roleId: string) {
    const papel = await this.organizations.findRole(roleId, organizationId);
    if (!papel) throw new ValidationException('Invalid role');
    if (papel.key === 'OWNER' || papel.permissions.includes('*')) {
      throw new ValidationException(
        'A role granting every permission cannot be assigned from the team screen',
      );
    }
    return papel;
  }

  private requireBusinessUnits(
    informadas: readonly string[] | undefined,
    unidades: readonly { id: string; isPrimary?: boolean }[],
  ): string[] {
    if (!informadas?.length) {
      const principal =
        unidades.find((unidade) => unidade.isPrimary) ?? unidades[0];
      if (!principal) {
        throw new ValidationException(
          'The organization has no business unit to assign',
        );
      }
      return [principal.id];
    }
    const unique = [...new Set(informadas)];
    if (
      unique.some(
        (businessUnitId) =>
          !unidades.some((unidade) => unidade.id === businessUnitId),
      )
    )
      throw new ValidationException('Invalid business unit');
    return unique;
  }

  private validateAccess(
    permissions: readonly string[],
    allowedSurfaces: readonly string[],
  ): void {
    if (
      permissions.includes('*') ||
      permissions.some((item) => !isKnownPermission(item))
    )
      throw new ValidationException('Unknown or non-delegable permission');
    if (
      allowedSurfaces.length === 0 ||
      allowedSurfaces.some(
        (surface) =>
          !ROLE_SURFACES.includes(surface as (typeof ROLE_SURFACES)[number]),
      )
    )
      throw new ValidationException('Invalid access surface');
  }

  private async assertMemberInActorScope(
    actor: TeamActor,
    userId: string,
  ): Promise<void> {
    if (actor.isOrganizationOwner) return;
    const targetUnits = (
      await this.organizations.listBusinessUnitMemberships(actor.organizationId)
    )
      .filter((membership) => membership.userId === userId)
      .map((membership) => membership.businessUnit.id);
    if (
      targetUnits.length === 0 ||
      targetUnits.some(
        (unitId) => !this.authorization.canAccessUnit(actor, unitId),
      )
    ) {
      throw new ForbiddenException('Member is outside actor scope');
    }
  }
}
