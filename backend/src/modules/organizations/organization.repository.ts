import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import type { CreateOrganizationDto } from './dto/organization.dto';
import { ASSIGNABLE_TEAM_ROLES } from './team-roles';

const organizationView = {
  plan: true,
  businessUnits: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.OrganizationInclude;

/** Projeção única do papel — o que `listRoles`, `createRole` e `updateRole` devolvem. */
const ROLE_VIEW = {
  id: true,
  key: true,
  name: true,
  description: true,
  permissions: true,
  allowedSurfaces: true,
  isSystem: true,
  organizationId: true,
  _count: { select: { organizationMemberships: true } },
} satisfies Prisma.RoleSelect;

/**
 * A pessoa, como as consultas de membro a projetam.
 *
 * Era a mesma seleção escrita **quatro** vezes. Cópias de uma projeção divergem
 * na primeira vez que alguém acrescenta um campo em duas delas, e o cliente passa
 * a receber respostas diferentes para a mesma pergunta dependendo da rota.
 *
 * `professionalSignatures` traz **só a existência**: `take: 1` e apenas o `id`.
 * Quem escolhe um responsável precisa saber se o documento sairá assinado; a
 * imagem é lida pelo gerador, no servidor, e não tem por que atravessar a rede.
 */
const memberUserView = {
  id: true,
  displayName: true,
  email: true,
  avatarUrl: true,
  status: true,
  professionalSignatures: {
    where: { active: true, revokedAt: null },
    take: 1,
    select: { id: true },
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class OrganizationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  findPlanByKey(key: string) {
    return this.prisma.plan.findFirst({ where: { key, isActive: true } });
  }

  create(
    ownerUserId: string,
    input: CreateOrganizationDto,
    slug: string,
    businessUnitSlug: string,
  ) {
    const organizationId = generateUuidV7();
    const businessUnitId = generateUuidV7();
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt);
    trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 14);

    return this.prisma.$transaction(async (transaction) => {
      const plan = await transaction.plan.findFirst({
        where: { key: input.planKey, isActive: true },
      });
      if (!plan) return null;
      await this.setLocal(transaction, 'app.user_id', ownerUserId);
      await this.setLocal(transaction, 'app.organization_id', organizationId);
      await this.setLocal(transaction, 'app.business_unit_id', businessUnitId);
      await this.setLocal(transaction, 'app.business_unit_ids', businessUnitId);

      await transaction.organization.create({
        data: {
          id: organizationId,
          ownerUserId,
          planId: plan.id,
          slug,
          displayName: input.displayName,
          primarySegment: input.primarySegment,
          status: 'ACTIVE',
          subscriptionStatus: 'TRIALING',
          subscriptionStartedAt: trialStartedAt,
          currentPeriodStart: trialStartedAt,
          currentPeriodEnd: trialEndsAt,
        },
      });
      const ownerRole = await transaction.role.create({
        data: {
          organizationId,
          key: 'OWNER',
          name: 'Owner',
          description: 'Organization owner',
          permissions: [],
          allowedSurfaces: ['WEB', 'MOBILE'],
          isSystem: true,
        },
      });
      await transaction.businessUnit.create({
        data: {
          id: businessUnitId,
          organizationId,
          slug: businessUnitSlug,
          isPrimary: true,
          legalName: input.primaryBusinessUnit.legalName,
          tradeName: input.primaryBusinessUnit.tradeName,
          code: input.primaryBusinessUnit.code,
          type: input.primaryBusinessUnit.type,
          documentType: input.primaryBusinessUnit.documentType,
          documentNumber: input.primaryBusinessUnit.documentNumber,
          city: input.primaryBusinessUnit.city,
          street: input.primaryBusinessUnit.street,
          number: input.primaryBusinessUnit.number,
          stateCode: input.primaryBusinessUnit.stateCode,
          postalCode: input.primaryBusinessUnit.postalCode,
          email: input.primaryBusinessUnit.email,
          phone: input.primaryBusinessUnit.phone,
        },
      });
      await transaction.organizationMembership.create({
        data: { organizationId, userId: ownerUserId, roleId: ownerRole.id },
      });
      await transaction.role.createMany({
        data: ASSIGNABLE_TEAM_ROLES.map((role) => ({
          organizationId,
          key: role.key,
          name: role.name,
          description: role.description,
          permissions: [...role.permissions],
          allowedSurfaces: [...role.allowedSurfaces],
          isSystem: true,
        })),
      });
      await transaction.businessUnitMembership.create({
        data: {
          organizationId,
          businessUnitId,
          userId: ownerUserId,
          roleId: ownerRole.id,
        },
      });

      /**
       * O dono nasce habilitado como técnico de campo.
       *
       * ## Por que verdadeiro por padrão
       *
       * Porque no primeiro dia a organização é uma pessoa. Quem acabou de criar a
       * conta é quem vai ao local, assina o PMOC e responde pelo atendimento — e sem
       * esta linha ele não aparecia em nenhum seletor de técnico: nem na atribuição
       * de operação, nem no responsável operacional do PMOC. O curinga de permissões
       * do dono não resolve isso, porque o perfil profissional é requisito de
       * domínio separado do RBAC: ter todas as permissões não torna ninguém
       * profissional.
       *
       * ## E por que continua sendo desligável
       *
       * A organização cresce e o dono deixa de ir a campo. O interruptor está no
       * perfil do membro (Equipe › o membro › Perfil profissional) e desligar tira
       * o nome dos seletores sem mexer em permissão nenhuma.
       *
       * ## E responsabilidade técnica também
       *
       * Aqui o dono é a exceção, e foi decisão de produto. Em qualquer outro cadastro
       * `technical_responsible_enabled` nasce falso, porque responsabilidade técnica
       * é designação legal com credencial de conselho atrás e presumi-la afirmaria o
       * que ninguém verificou. No dono a conta é outra: o PMOC exige um Responsável
       * Técnico para a execução começar, e numa empresa de uma pessoa é ele — nascer
       * falso deixaria o produto inutilizável no primeiro plano, obrigando a
       * descobrir um interruptor escondido no perfil do próprio usuário.
       *
       * O que o sistema **não** afirma é que a credencial existe: ele registra a
       * declaração de quem criou a conta, e a credencial se cadastra no perfil
       * profissional. A assinatura, que é o que sai no documento, continua sendo
       * exigida de verdade — na abertura da execução, por `assertTechnicalResponsible`
       * com `requireSignature`.
       */
      await transaction.professionalProfile.create({
        data: {
          organizationId,
          userId: ownerUserId,
          fieldTechnicianEnabled: true,
          technicalResponsibleEnabled: true,
          active: true,
        },
      });

      return transaction.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: organizationView,
      });
    });
  }

  findCurrent(id: string) {
    return this.rls.run((transaction) =>
      transaction.organization.findUnique({
        where: { id, deletedAt: null },
        include: organizationView,
      }),
    );
  }

  /**
   * Membros ativos e suspensos da organização.
   *
   * Associações removidas (`deletedAt`) ficam de fora — quem saiu não pode
   * receber trabalho novo. O status da associação é publicado para que o
   * cliente distinga quem está ativo de quem está suspenso sem inferir nada.
   */
  /**
   * Papéis da organização.
   *
   * **Só os próprios.** Papéis globais (`organizationId: null`) são de
   * plataforma — hoje apenas `PLATFORM_ADMIN`, atribuído por
   * `PlatformRoleAssignment`, uma tabela que nada tem a ver com a associação
   * de um tenant. Listá-lo aqui mostraria ao gestor um papel que ele não pode
   * conceder e que não descreve ninguém da equipe dele.
   */
  listRoles(organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.role.findMany({
        where: {
          organizationId,
          deletedAt: null,
          key: { not: 'OWNER' },
        },
        select: ROLE_VIEW,
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
    );
  }

  /**
   * Unidades de cada pessoa.
   *
   * `BusinessUnitMembership` já existia e nunca foi publicada. Sem ela, a
   * equipe aparece como uma lista plana e não há como saber quem atende qual
   * unidade — que é a primeira pergunta de quem escala trabalho.
   */
  listBusinessUnitMemberships(organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.businessUnitMembership.findMany({
        where: { organizationId, status: 'ACTIVE', deletedAt: null },
        select: {
          userId: true,
          businessUnit: {
            select: { id: true, legalName: true, tradeName: true },
          },
        },
      }),
    );
  }

  findMembership(organizationId: string, userId: string) {
    return this.rls.run((transaction) =>
      transaction.organizationMembership.findFirst({
        where: { organizationId, userId, deletedAt: null },
      }),
    );
  }

  updateMembership(id: string, data: { roleId?: string; status?: string }) {
    return this.rls.run((transaction) =>
      transaction.organizationMembership.update({
        where: { id },
        data,
        select: {
          userId: true,
          status: true,
          joinedAt: true,
          user: { select: memberUserView },
          usesCustomAccess: true,
          customPermissions: true,
          customAllowedSurfaces: true,
          role: {
            select: {
              id: true,
              key: true,
              name: true,
              permissions: true,
              allowedSurfaces: true,
            },
          },
        },
      }),
    );
  }

  findRole(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.role.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  findBusinessUnits(organizationId: string, ids: readonly string[]) {
    return this.rls.run((transaction) =>
      transaction.businessUnit.findMany({
        where: {
          organizationId,
          id: { in: [...ids] },
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { id: true },
      }),
    );
  }

  updateMemberAccess(
    organizationId: string,
    membershipId: string,
    userId: string,
    actorId: string,
    data: {
      roleId?: string;
      status?: string;
      usesCustomAccess?: boolean;
      customPermissions?: string[];
      customAllowedSurfaces?: string[];
      businessUnitIds?: readonly string[];
    },
  ) {
    return this.rls.runAmbient(async (transaction) => {
      const updated = await transaction.organizationMembership.update({
        where: { id: membershipId },
        data: {
          roleId: data.roleId,
          status: data.status,
          usesCustomAccess: data.usesCustomAccess,
          customPermissions: data.customPermissions,
          customAllowedSurfaces: data.customAllowedSurfaces,
        },
        select: {
          userId: true,
          status: true,
          joinedAt: true,
          usesCustomAccess: true,
          customPermissions: true,
          customAllowedSurfaces: true,
          user: { select: memberUserView },
          role: {
            select: {
              id: true,
              key: true,
              name: true,
              permissions: true,
              allowedSurfaces: true,
            },
          },
        },
      });
      if (data.roleId) {
        await transaction.businessUnitMembership.updateMany({
          where: { organizationId, userId, deletedAt: null },
          data: { roleId: data.roleId },
        });
      }
      if (data.businessUnitIds) {
        await transaction.businessUnitMembership.updateMany({
          where: {
            organizationId,
            userId,
            deletedAt: null,
            businessUnitId: { notIn: [...data.businessUnitIds] },
          },
          data: { status: 'INACTIVE', deletedAt: new Date() },
        });
        for (const businessUnitId of data.businessUnitIds) {
          await transaction.businessUnitMembership.upsert({
            where: { businessUnitId_userId: { businessUnitId, userId } },
            create: {
              organizationId,
              businessUnitId,
              userId,
              roleId: updated.role.id,
            },
            update: {
              roleId: updated.role.id,
              status: 'ACTIVE',
              deletedAt: null,
            },
          });
        }
      }
      await transaction.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          organizationId,
          userId: actorId,
          action: 'ORGANIZATION_MEMBER_ACCESS_UPDATED',
          entityType: 'ORGANIZATION_MEMBERSHIP',
          entityId: membershipId,
          metadata: {
            targetUserId: userId,
            roleChanged: Boolean(data.roleId),
            customAccessChanged: data.usesCustomAccess !== undefined,
            unitScopeChanged: data.businessUnitIds !== undefined,
            roleId: data.roleId ?? null,
            status: data.status ?? null,
            useRoleDefaults:
              data.usesCustomAccess === undefined
                ? null
                : !data.usesCustomAccess,
            allowedSurfaces: data.customAllowedSurfaces ?? null,
            businessUnitIds: data.businessUnitIds
              ? [...data.businessUnitIds]
              : null,
            permissionCount: data.customPermissions?.length ?? null,
          },
        },
      });
      return updated;
    });
  }

  createRole(data: Prisma.RoleUncheckedCreateInput) {
    return this.rls.run((transaction) =>
      transaction.role.create({
        data,
        select: ROLE_VIEW,
      }),
    );
  }

  updateRole(id: string, data: Prisma.RoleUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.role.update({ where: { id }, data, select: ROLE_VIEW }),
    );
  }

  /** Quantas pessoas ainda dependem deste papel — o servidor recusa remover. */
  roleDependencies(id: string) {
    return this.rls.run(async (transaction) => {
      const members = await transaction.organizationMembership.count({
        where: { roleId: id, deletedAt: null },
      });
      const invitations = await transaction.identityInvitation.count({
        where: { roleId: id, status: 'PENDING' },
      });
      return { members, invitations };
    });
  }

  softDeleteRole(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.role.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      )
      .then(() => undefined);
  }

  countMembers(organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.organizationMembership.count({
        where: { organizationId, deletedAt: null },
      }),
    );
  }

  /**
   * Um membro, pela pessoa.
   *
   * A mesma projeção da listagem: a página de detalhe mostra o que a lista
   * mostra, e uma segunda projeção divergiria no primeiro campo novo.
   *
   * Existe porque a página precisa carregar **uma** pessoa. Antes a tela recebia
   * o objeto da listagem, o que só funciona em drawer aberto a partir dela —
   * endereço direto, recarregar a página ou abrir em outra aba não tinham de
   * onde buscar.
   */
  findMember(organizationId: string, userId: string) {
    return this.rls.run((transaction) =>
      transaction.organizationMembership.findFirst({
        where: { organizationId, userId, deletedAt: null },
        select: {
          userId: true,
          status: true,
          joinedAt: true,
          user: { select: memberUserView },
          usesCustomAccess: true,
          customPermissions: true,
          customAllowedSurfaces: true,
          role: {
            select: {
              id: true,
              key: true,
              name: true,
              permissions: true,
              allowedSurfaces: true,
            },
          },
        },
      }),
    );
  }

  listMembers(
    organizationId: string,
    pagination?: { skip: number; take: number },
  ) {
    return this.rls.run((transaction) =>
      transaction.organizationMembership.findMany({
        where: { organizationId, deletedAt: null },
        ...(pagination ?? {}),
        select: {
          userId: true,
          status: true,
          joinedAt: true,
          user: { select: memberUserView },
          usesCustomAccess: true,
          customPermissions: true,
          customAllowedSurfaces: true,
          role: {
            select: {
              id: true,
              key: true,
              name: true,
              permissions: true,
              allowedSurfaces: true,
            },
          },
        },
        orderBy: { user: { displayName: 'asc' } },
      }),
    );
  }

  /**
   * A marca, sozinha.
   *
   * Consulta própria e não `findCurrent`: a imagem chega a meio megabyte, e o
   * `organizationView` traz plano e unidades junto. Quem quer o timbre não quer
   * o resto, e quem quer o resto não quer meio megabyte.
   */
  findLogo(id: string) {
    return this.rls.run((transaction) =>
      transaction.organization.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, logoUrl: true },
      }),
    );
  }

  setLogo(id: string, logoUrl: string | null) {
    return this.rls.run((transaction) =>
      transaction.organization.update({
        where: { id },
        data: { logoUrl },
        select: { id: true, logoUrl: true },
      }),
    );
  }

  updateCurrent(id: string, data: Prisma.OrganizationUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.organization.update({
        where: { id },
        data,
        include: organizationView,
      }),
    );
  }

  private setLocal(
    transaction: Prisma.TransactionClient,
    key: string,
    value: string,
  ): Promise<unknown> {
    return transaction.$queryRawUnsafe(
      'SELECT set_config($1, $2, true)',
      key,
      value,
    );
  }
}
