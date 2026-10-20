import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';

/**
 * Escrita de pessoas da organização.
 *
 * Separado do `OrganizationRepository` porque o que acontece aqui atravessa
 * dois agregados — `User`/`Credential` são de identidade, `*Membership` é da
 * organização — e precisa acontecer numa transação só: um usuário criado sem
 * vínculo ficaria órfão, capaz de autenticar e incapaz de ver qualquer coisa.
 */
@Injectable()
export class TeamRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  /**
   * Cria a pessoa e os dois vínculos, cobrando a vaga dentro da transação.
   *
   * `assertQuota` é entregue pelo chamador e roda **aqui dentro**, com o
   * contexto de inquilino já definido: contar assentos fora desta transação
   * abriria a janela em que duas criações simultâneas passam pelo mesmo teto.
   */
  createMember(
    input: {
      organizationId: string;
      businessUnitIds: readonly string[];
      roleId: string;
      usesCustomAccess: boolean;
      customPermissions: string[];
      customAllowedSurfaces: string[];
      actorId: string;
      email: string;
      normalizedEmail: string;
      firstName: string;
      lastName: string;
      passwordHash: string;
      /** O acesso concedido já disse que esta pessoa executa em campo. */
      fieldTechnicianEnabled: boolean;
    },
    assertQuota: (transaction: PrismaTransactionClient) => Promise<void>,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(
        transaction,
        'app.organization_id',
        input.organizationId,
      );
      await this.setLocal(
        transaction,
        'app.business_unit_ids',
        input.businessUnitIds.join(','),
      );

      const existente = await transaction.user.findUnique({
        where: { normalizedEmail: input.normalizedEmail },
        select: { id: true },
      });
      if (existente) return { conflict: 'EMAIL_TAKEN' as const };

      await assertQuota(transaction);

      const user = await transaction.user.create({
        data: {
          email: input.email,
          normalizedEmail: input.normalizedEmail,
          firstName: input.firstName,
          lastName: input.lastName,
          displayName: `${input.firstName} ${input.lastName}`.trim(),
          status: 'ACTIVE',
          /**
           * Verificado na criação: quem cadastra é o dono da organização, que
           * já conhece a pessoa. Exigir confirmação por e-mail travaria o
           * técnico sem e-mail — o caso que motivou a senha temporária.
           */
          emailVerifiedAt: new Date(),
          credential: {
            create: {
              passwordHash: input.passwordHash,
              /** O ponto do fluxo: a senha do owner não sobrevive ao 1º acesso. */
              mustChangePassword: true,
            },
          },
        },
        select: { id: true },
      });

      await transaction.organizationMembership.create({
        data: {
          organizationId: input.organizationId,
          userId: user.id,
          roleId: input.roleId,
          usesCustomAccess: input.usesCustomAccess,
          customPermissions: input.customPermissions,
          customAllowedSurfaces: input.customAllowedSurfaces,
        },
      });
      await transaction.businessUnitMembership.createMany({
        data: input.businessUnitIds.map((businessUnitId) => ({
          organizationId: input.organizationId,
          businessUnitId,
          userId: user.id,
          roleId: input.roleId,
        })),
      });
      /**
       * O perfil profissional, na mesma transação do vínculo.
       *
       * Fora dela, um erro depois do `create` deixaria um técnico cadastrado e
       * invisível para a operação — exatamente o estado que esta linha existe
       * para não acontecer mais.
       *
       * `technical_responsible_enabled` fica falso: responsabilidade técnica é
       * designação legal com credencial de conselho atrás, e deduzi-la de
       * permissões afirmaria o que o RBAC não sabe. Liga-se no perfil do membro.
       */
      if (input.fieldTechnicianEnabled) {
        await transaction.professionalProfile.create({
          data: {
            organizationId: input.organizationId,
            userId: user.id,
            fieldTechnicianEnabled: true,
            technicalResponsibleEnabled: false,
            active: true,
          },
        });
      }

      await transaction.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.actorId,
          action: 'ORGANIZATION_MEMBER_CREATED',
          entityType: 'ORGANIZATION_MEMBERSHIP',
          entityId: user.id,
          metadata: {
            targetUserId: user.id,
            roleId: input.roleId,
            unitCount: input.businessUnitIds.length,
            usesCustomAccess: input.usesCustomAccess,
            fieldTechnicianEnabled: input.fieldTechnicianEnabled,
          },
        },
      });

      return { userId: user.id };
    });
  }

  /** O membro, com o vínculo e o papel — para responder e para autorizar. */
  findMember(organizationId: string, userId: string) {
    return this.rls.run((transaction) =>
      transaction.organizationMembership.findFirst({
        where: { organizationId, userId, deletedAt: null },
        select: {
          id: true,
          userId: true,
          status: true,
          joinedAt: true,
          usesCustomAccess: true,
          customPermissions: true,
          customAllowedSurfaces: true,
          user: {
            select: {
              id: true,
              displayName: true,
              email: true,
              avatarUrl: true,
              status: true,
            },
          },
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

  /**
   * Desligamento: o vínculo sai, a pessoa fica.
   *
   * `User` não é apagado de propósito. Ele assina laudo, executa atendimento e
   * aparece no histórico; removê-lo deixaria documento emitido sem autor. O que
   * se desfaz é o vínculo — e é ele que ocupa a vaga do plano.
   */
  removeMember(organizationId: string, userId: string) {
    return this.prisma.$transaction(async (transaction) => {
      await this.setLocal(transaction, 'app.organization_id', organizationId);
      const agora = new Date();
      await transaction.organizationMembership.updateMany({
        where: { organizationId, userId, deletedAt: null },
        data: { status: 'INACTIVE', deletedAt: agora },
      });
      await transaction.businessUnitMembership.updateMany({
        where: { organizationId, userId, deletedAt: null },
        data: { status: 'INACTIVE', deletedAt: agora },
      });
      /**
       * As sessões abertas morrem junto.
       *
       * Sem isto, o desligado continuaria trabalhando com o token que já tinha
       * na mão até ele expirar — e o motivo de desligar alguém costuma ser
       * exatamente não querer isso.
       */
      await transaction.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: agora },
      });
    });
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
