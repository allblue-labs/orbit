import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database';
import { generateUuidV7 } from '../../../utils';
import type { RegisterOrganizationDto } from '../presentation/dto/identity.dto';
import {
  ASSIGNABLE_TEAM_ROLES,
  OWNER_ROLE_KEY,
} from '../../organizations/team-roles';
import { RVT_MAINTENANCE_TYPE_SEEDS } from '../../rvt/rvt-maintenance-types.seed';

export type TenantProvisioningOptions = {
  actorUserId?: string;
  platformAdmin?: boolean;
  organizationStatus?: string;
  subscriptionStatus?: string;
  subscriptionStartedAt?: Date;
  currentPeriodEnd?: Date;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
};

@Injectable()
export class RegistrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  register(
    input: RegisterOrganizationDto,
    passwordHash: string,
    slug: string,
    options: TenantProvisioningOptions = {},
  ) {
    const userId = generateUuidV7();
    const organizationId = generateUuidV7();
    const businessUnitId = generateUuidV7();
    const now = options.subscriptionStartedAt ?? new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 14);

    return this.prisma.$transaction(async (transaction) => {
      const plan = await transaction.plan.findFirst({
        where: { key: input.planKey, isActive: true },
      });
      if (!plan) return null;

      await this.setLocal(
        transaction,
        'app.user_id',
        options.actorUserId ?? userId,
      );
      await this.setLocal(
        transaction,
        'app.is_platform_admin',
        String(options.platformAdmin ?? false),
      );
      await this.setLocal(transaction, 'app.organization_id', organizationId);
      await this.setLocal(transaction, 'app.business_unit_id', businessUnitId);
      await this.setLocal(transaction, 'app.business_unit_ids', businessUnitId);

      await transaction.user.create({
        data: {
          id: userId,
          email: input.email,
          normalizedEmail: input.email,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          displayName: `${input.firstName} ${input.lastName}`.trim(),
          status: 'ACTIVE',
          emailVerifiedAt: now,
          credential: { create: { passwordHash } },
        },
      });
      await transaction.organization.create({
        data: {
          id: organizationId,
          ownerUserId: userId,
          planId: plan.id,
          slug,
          displayName: input.organizationName.trim(),
          primarySegment: input.primarySegment,
          status: options.organizationStatus ?? 'ACTIVE',
          subscriptionStatus: options.subscriptionStatus ?? 'TRIALING',
          subscriptionStartedAt: now,
          currentPeriodStart: now,
          currentPeriodEnd: options.currentPeriodEnd ?? trialEndsAt,
          externalCustomerId: options.externalCustomerId,
          externalSubscriptionId: options.externalSubscriptionId,
        },
      });
      const ownerRole = await transaction.role.create({
        data: {
          organizationId,
          key: OWNER_ROLE_KEY,
          name: 'Owner',
          description: 'Organization owner',
          permissions: [],
          allowedSurfaces: ['WEB', 'MOBILE'],
          isSystem: true,
        },
      });

      /**
       * Os papéis de técnico nascem com a organização.
       *
       * Sem eles a tela de equipe abriria com um seletor de papel contendo só
       * "Owner", e cadastrar o primeiro técnico exigiria compor permissões à
       * mão. Criar aqui é o que torna o cadastro possível no primeiro dia.
       */
      /**
       * Os ritmos de manutenção de RVT nascem com a organização.
       *
       * Sem eles a primeira visita técnica exigiria cadastrar um tipo antes, e
       * "Semanal, 7 dias" não é decisão que valha pedir a alguém.
       */
      await transaction.rvtMaintenanceType.createMany({
        data: RVT_MAINTENANCE_TYPE_SEEDS.map((tipo) => ({
          organizationId,
          key: tipo.key,
          label: tipo.label,
          intervalDays: tipo.intervalDays,
          intervalMonths: tipo.intervalMonths,
          sortOrder: tipo.sortOrder,
        })),
      });

      await transaction.role.createMany({
        data: ASSIGNABLE_TEAM_ROLES.map((papel) => ({
          organizationId,
          key: papel.key,
          name: papel.name,
          description: papel.description,
          permissions: [...papel.permissions],
          allowedSurfaces: [...papel.allowedSurfaces],
          isSystem: true,
        })),
      });
      await transaction.businessUnit.create({
        data: {
          id: businessUnitId,
          organizationId,
          slug: `${slug}-matriz`,
          isPrimary: true,
          legalName: input.legalName.trim(),
          tradeName: input.organizationName.trim(),
          type: input.businessUnitType,
          documentType: input.documentType,
          documentNumber: input.documentNumber,
          city: input.city.trim(),
          street: input.street.trim(),
          stateCode: input.stateCode.toUpperCase(),
        },
      });
      await transaction.organizationMembership.create({
        data: { organizationId, userId, roleId: ownerRole.id },
      });
      await transaction.businessUnitMembership.create({
        data: {
          organizationId,
          businessUnitId,
          userId,
          roleId: ownerRole.id,
        },
      });
      if (options.platformAdmin) {
        await transaction.auditLog.create({
          data: {
            organizationId,
            userId: options.actorUserId,
            action: 'PLATFORM_TENANT_CREATED',
            entityType: 'ORGANIZATION',
            entityId: organizationId,
            after: {
              ownerUserId: userId,
              planKey: plan.key,
              status: options.organizationStatus ?? 'ACTIVE',
              subscriptionStatus: options.subscriptionStatus ?? 'TRIALING',
            },
          },
        });
      }
      return { userId, organizationId, businessUnitId };
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
