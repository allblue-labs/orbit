import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthorizationService } from '../../common';
import { readEmbeddedImage } from '../../common/embedded-image';
import type { AuthenticatedIdentity } from '../identity/domain/identity.types';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import { SlugHelper } from '../../helpers';
import type {
  CreateOrganizationDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';
import { OrganizationRepository } from './organization.repository';
import {
  DEFAULT_ROLE_SURFACES,
  PERMISSION_GROUPS,
  ROLE_SURFACES,
  isKnownPermission,
} from './team-roles';

type AccessActor = Pick<
  AuthenticatedIdentity,
  | 'id'
  | 'permissions'
  | 'allowedSurfaces'
  | 'businessUnitIds'
  | 'isOrganizationOwner'
>;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly repository: OrganizationRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(ownerUserId: string, input: CreateOrganizationDto) {
    const slug = SlugHelper.create(input.displayName);
    const businessUnitSlug = SlugHelper.create(
      input.primaryBusinessUnit.tradeName ??
        input.primaryBusinessUnit.legalName,
    );
    if (!slug || !businessUnitSlug) {
      throw new ValidationException('Unable to generate a valid slug');
    }
    try {
      const organization = await this.repository.create(
        ownerUserId,
        input,
        slug,
        businessUnitSlug,
      );
      if (!organization) throw new ValidationException('Invalid plan');
      return organization;
    } catch (error) {
      if (error instanceof ValidationException) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Organization or primary business unit already exists',
        );
      }
      throw error;
    }
  }

  async getCurrent(organizationId: string) {
    const organization = await this.repository.findCurrent(organizationId);
    if (!organization) throw new EntityNotFoundException('Organization');
    return organization;
  }

  /** Membros da organização, com o dono identificado pelo próprio registro. */
  async listMembers(
    organizationId: string,
    pagination?: { page: number; limit: number },
  ) {
    const organization = await this.getCurrent(organizationId);
    const window = pagination
      ? {
          skip: (pagination.page - 1) * pagination.limit,
          take: pagination.limit,
        }
      : undefined;

    const [members, unitMemberships, total] = await Promise.all([
      this.repository.listMembers(organizationId, window),
      this.repository.listBusinessUnitMemberships(organizationId),
      this.repository.countMembers(organizationId),
    ]);
    return {
      members,
      unitMemberships,
      total,
      ownerUserId: organization.ownerUserId,
    };
  }

  /**
   * Um membro, com o mesmo Read Model da listagem.
   *
   * O vínculo de unidade vem inteiro porque o mapeador o cruza por pessoa — é a
   * mesma consulta que a listagem faz, e uma variante "só as unidades deste
   * membro" seria um segundo caminho para o mesmo dado.
   */
  async getMember(organizationId: string, userId: string) {
    const organization = await this.getCurrent(organizationId);
    const member = await this.repository.findMember(organizationId, userId);
    if (!member) {
      throw new EntityNotFoundException('Organization member', userId);
    }
    const unitMemberships =
      await this.repository.listBusinessUnitMemberships(organizationId);

    return {
      member,
      unitMemberships,
      ownerUserId: organization.ownerUserId,
    };
  }

  /**
   * Altera papel e situação de um membro.
   *
   * ## O dono não muda
   *
   * `ownerUserId` é atributo da organização. Rebaixar o dono deixaria a conta
   * sem ninguém capaz de administrá-la — e transferir a propriedade é outra
   * operação, com outras consequências, que este endpoint não faz.
   */
  async updateMember(
    organizationId: string,
    userId: string,
    input: {
      roleId?: string;
      status?: string;
      businessUnitIds?: string[];
      useRoleDefaults?: boolean;
      permissions?: string[];
      allowedSurfaces?: string[];
    },
    actor: AccessActor,
  ) {
    const organization = await this.getCurrent(organizationId);

    if (
      input.roleId === undefined &&
      input.status === undefined &&
      input.businessUnitIds === undefined &&
      input.useRoleDefaults === undefined &&
      input.permissions === undefined &&
      input.allowedSurfaces === undefined
    ) {
      throw new ValidationException('No member access changes provided');
    }

    if (userId === organization.ownerUserId) {
      throw new ValidationException(
        'The organization owner cannot be modified here',
      );
    }
    if (userId === actor.id) {
      throw new ValidationException('You cannot change your own access');
    }

    const membership = await this.repository.findMembership(
      organizationId,
      userId,
    );
    if (!membership) throw new EntityNotFoundException('Member', userId);
    await this.assertMemberInActorScope(actor, organizationId, userId);

    const role = await this.repository.findRole(
      input.roleId ?? membership.roleId,
      organizationId,
    );
    if (!role || role.key === 'OWNER')
      throw new ValidationException('Invalid role');

    const explicitCustom =
      input.useRoleDefaults === false ||
      input.permissions !== undefined ||
      input.allowedSurfaces !== undefined;
    const usesCustomAccess =
      input.useRoleDefaults !== undefined
        ? !input.useRoleDefaults
        : input.roleId
          ? explicitCustom
          : membership.usesCustomAccess || explicitCustom;
    const accessChanged =
      input.roleId !== undefined ||
      input.useRoleDefaults !== undefined ||
      input.permissions !== undefined ||
      input.allowedSurfaces !== undefined;
    const currentPermissions = membership.usesCustomAccess
      ? membership.customPermissions
      : role.permissions;
    const currentSurfaces = membership.usesCustomAccess
      ? membership.customAllowedSurfaces
      : role.allowedSurfaces;
    const permissions = usesCustomAccess
      ? (input.permissions ?? currentPermissions)
      : role.permissions;
    const allowedSurfaces = usesCustomAccess
      ? (input.allowedSurfaces ?? currentSurfaces)
      : role.allowedSurfaces;
    this.validateAccess(permissions, allowedSurfaces);
    this.assertDelegable(actor, permissions, allowedSurfaces);

    const unitIds = input.businessUnitIds
      ? [...new Set(input.businessUnitIds)]
      : undefined;
    if (unitIds) await this.assertUnits(actor, organizationId, unitIds);

    const updated = await this.repository.updateMemberAccess(
      organizationId,
      membership.id,
      userId,
      actor.id,
      {
        roleId: input.roleId,
        status: input.status,
        usesCustomAccess: accessChanged ? usesCustomAccess : undefined,
        customPermissions: accessChanged
          ? usesCustomAccess
            ? [...permissions]
            : []
          : undefined,
        customAllowedSurfaces: accessChanged
          ? usesCustomAccess
            ? [...allowedSurfaces]
            : []
          : undefined,
        businessUnitIds: unitIds,
      },
    );
    const unitMemberships = (
      await this.repository.listBusinessUnitMemberships(organizationId)
    ).filter((item) => item.userId === userId);
    return {
      member: updated,
      ownerUserId: organization.ownerUserId,
      unitMemberships,
    };
  }

  async listRoles(organizationId: string) {
    await this.getCurrent(organizationId);
    return this.repository.listRoles(organizationId);
  }

  async createRole(
    organizationId: string,
    input: {
      name: string;
      description?: string;
      permissions?: string[];
      allowedSurfaces?: string[];
    },
    actor: AccessActor,
  ) {
    await this.getCurrent(organizationId);
    const permissions = input.permissions ?? [];
    const allowedSurfaces = input.allowedSurfaces ?? [...DEFAULT_ROLE_SURFACES];
    this.validateAccess(permissions, allowedSurfaces);
    this.assertDelegable(actor, permissions, allowedSurfaces);
    try {
      return await this.repository.createRole({
        organizationId,
        key: this.roleKey(input.name),
        name: input.name,
        description: input.description,
        permissions,
        /** Omitido, o papel nasce podendo os dois — como todo papel podia. */
        allowedSurfaces,
        /** Papel criado pela organização nunca é de sistema. */
        isSystem: false,
      });
    } catch (error) {
      this.rethrowRoleConflict(error);
    }
  }

  async updateRole(
    id: string,
    organizationId: string,
    input: {
      name?: string;
      description?: string;
      permissions?: string[];
      allowedSurfaces?: string[];
    },
    actor: AccessActor,
  ) {
    const role = await this.requireRole(id, organizationId);

    /**
     * Papel de sistema não se edita.
     *
     * `isSystem` marca o que a plataforma semeou; alterar as suas permissões
     * mudaria o significado do papel para além desta organização.
     */
    if (role.isSystem) {
      throw new ValidationException('System roles cannot be modified');
    }
    const permissions = input.permissions ?? role.permissions;
    const allowedSurfaces = input.allowedSurfaces ?? role.allowedSurfaces;
    this.validateAccess(permissions, allowedSurfaces);
    this.assertDelegable(actor, permissions, allowedSurfaces);

    try {
      return await this.repository.updateRole(id, {
        name: input.name,
        description: input.description,
        permissions: input.permissions,
        allowedSurfaces: input.allowedSurfaces,
        ...(input.name ? { key: this.roleKey(input.name) } : {}),
      });
    } catch (error) {
      this.rethrowRoleConflict(error);
    }
  }

  accessCatalog() {
    return {
      surfaces: ROLE_SURFACES.filter((surface) => surface !== 'API').map(
        (surface) => ({
          code: surface,
          label: surface === 'WEB' ? 'Plataforma Web' : 'Aplicativo mobile',
        }),
      ),
      permissionGroups: PERMISSION_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        permissions: group.permissions.map((permission) => ({ ...permission })),
      })),
    };
  }

  private validateAccess(
    permissions: readonly string[],
    allowedSurfaces: readonly string[],
  ): void {
    if (
      permissions.includes('*') ||
      permissions.some((permission) => !isKnownPermission(permission))
    ) {
      throw new ValidationException('Unknown or non-delegable permission');
    }
    if (
      allowedSurfaces.length === 0 ||
      allowedSurfaces.some(
        (surface) =>
          !ROLE_SURFACES.includes(surface as (typeof ROLE_SURFACES)[number]),
      )
    ) {
      throw new ValidationException('Invalid access surface');
    }
  }

  private assertDelegable(
    actor: AccessActor,
    permissions: readonly string[],
    surfaces: readonly string[],
  ): void {
    if (!this.authorization.canDelegate(actor, permissions, surfaces)) {
      throw new ForbiddenException(
        'Access cannot exceed the current actor authority',
      );
    }
  }

  private async assertUnits(
    actor: AccessActor,
    organizationId: string,
    unitIds: readonly string[],
  ): Promise<void> {
    if (unitIds.length === 0)
      throw new ValidationException('At least one business unit is required');
    if (
      unitIds.some((unitId) => !this.authorization.canAccessUnit(actor, unitId))
    )
      throw new ForbiddenException('Business unit is outside actor scope');
    const existing = await this.repository.findBusinessUnits(
      organizationId,
      unitIds,
    );
    if (existing.length !== unitIds.length)
      throw new ValidationException('Invalid business unit scope');
  }

  private async assertMemberInActorScope(
    actor: AccessActor,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    if (actor.isOrganizationOwner) return;
    const targetUnits = (
      await this.repository.listBusinessUnitMemberships(organizationId)
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

  /**
   * Remove um papel.
   *
   * Recusa enquanto houver membro ou convite pendente apontando para ele —
   * caso contrário, uma pessoa ficaria sem papel e sem permissões, e um
   * convite não teria o que conceder ao ser aceito.
   */
  async removeRole(id: string, organizationId: string): Promise<void> {
    const role = await this.requireRole(id, organizationId);
    if (role.isSystem) {
      throw new ValidationException('System roles cannot be removed');
    }

    const dependencies = await this.repository.roleDependencies(id);
    if (dependencies.members > 0 || dependencies.invitations > 0) {
      throw new ConflictException(
        'Role still has members or pending invitations',
      );
    }
    await this.repository.softDeleteRole(id);
  }

  private async requireRole(id: string, organizationId: string) {
    const role = await this.repository.findRole(id, organizationId);
    if (!role) throw new EntityNotFoundException('Role', id);
    return role;
  }

  /**
   * Chave derivada do nome.
   *
   * `@@unique([organizationId, key])` exige uma chave estável; derivá-la do
   * nome mantém o padrão dos papéis semeados (`OWNER`) sem pedir ao usuário um
   * identificador técnico que ele não deveria inventar.
   */
  private roleKey(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  }

  private rethrowRoleConflict(error: unknown): never {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      throw new ConflictException('A role with this name already exists');
    }
    throw error;
  }

  /**
   * A marca da empresa.
   *
   * ## Por que tem rota própria
   *
   * Pelo mesmo motivo que o logo de unidade: o corpo tem centenas de
   * quilobytes. Se fosse campo do `PATCH current`, toda troca de nome
   * carregaria a imagem, e `GET current` — pedido em cada navegação — a
   * devolveria. O Read Model publica só `hasLogo`; a imagem se pede aqui.
   */
  async getLogo(organizationId: string) {
    const logo = await this.repository.findLogo(organizationId);
    if (!logo) throw new EntityNotFoundException('Organization');
    return logo;
  }

  /**
   * `readEmbeddedImage` decide se entra: recusa URL — que o servidor teria de
   * buscar, com o endereço escolhido pelo inquilino — recusa SVG, que carrega
   * script, e limita o tamanho. A mesma função valida de novo na leitura,
   * dentro do gerador de documento.
   */
  async setLogo(organizationId: string, image: string) {
    await this.getLogo(organizationId);

    const imagem = readEmbeddedImage(image);
    if (!imagem) {
      throw new ValidationException(
        'A imagem precisa ser um PNG ou JPEG de até 512 KB, enviado como data URI.',
      );
    }

    return this.repository.setLogo(organizationId, imagem.dataUrl);
  }

  /**
   * Volta a emitir sem timbre — a não ser onde a unidade tenha marca própria,
   * que não é esta.
   */
  async removeLogo(organizationId: string) {
    await this.getLogo(organizationId);
    return this.repository.setLogo(organizationId, null);
  }

  async update(organizationId: string, input: UpdateOrganizationDto) {
    await this.getCurrent(organizationId);
    return this.repository.updateCurrent(organizationId, {
      displayName: input.displayName,
      primarySegment: input.primarySegment,
      settings: input.settings as Prisma.InputJsonValue | undefined,
    });
  }
}
