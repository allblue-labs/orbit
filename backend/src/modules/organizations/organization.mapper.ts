import { Injectable } from '@nestjs/common';
import type { BusinessUnitType } from '../../contracts';
import type {
  BusinessUnitReadModel,
  OrganizationContextReadModel,
  OrganizationMemberReadModel,
  OrganizationPlanReadModel,
  OrganizationRoleReadModel,
} from './organization.read-models';

type DateValue = Date | string;
type DecimalValue = { toString(): string } | string | number | null;

interface BusinessUnitSource {
  id: string;
  logoUrl?: string | null;
  organizationId: string;
  parentId: string | null;
  slug: string;
  code: string | null;
  type: BusinessUnitType;
  isPrimary: boolean;
  legalName: string;
  tradeName: string | null;
  documentType: string;
  documentNumber: string;
  city: string;
  street: string;
  number: string | null;
  stateCode: string | null;
  postalCode: string | null;
  email: string | null;
  phone: string | null;
  timezone: string;
  locale: string;
  currency: string;
  status: string;
  createdAt: DateValue;
  updatedAt: DateValue;
}

interface PlanSource {
  id: string;
  key: string;
  name: string;
  description: string | null;
  monthlyPrice: DecimalValue;
  annualPrice: DecimalValue;
  currency: string;
  capabilities: readonly string[];
  limits: unknown;
  isActive: boolean;
}

interface OrganizationSource {
  id: string;
  ownerUserId: string;
  planId: string;
  slug: string;
  displayName: string;
  primarySegment: string;
  status: string;
  subscriptionStatus: string;
  subscriptionStartedAt: DateValue | null;
  currentPeriodStart: DateValue | null;
  currentPeriodEnd: DateValue | null;
  logoUrl?: string | null;
  settings: unknown;
  createdAt: DateValue;
  updatedAt: DateValue;
  plan: PlanSource;
  businessUnits: readonly BusinessUnitSource[];
}

interface MemberSource {
  userId: string;
  status: string;
  joinedAt: DateValue;
  user: {
    id: string;
    displayName: string;
    email: string;
    avatarUrl: string | null;
    status: string;
    /* Só a existência: `take: 1` na consulta, e nunca a imagem. */
    professionalSignatures?: readonly { id: string }[];
  };
  usesCustomAccess: boolean;
  customPermissions: readonly string[];
  customAllowedSurfaces: readonly string[];
  role: {
    id: string;
    key: string;
    name: string;
    permissions: readonly string[];
    allowedSurfaces: readonly string[];
  };
}

interface UnitMembershipSource {
  userId: string;
  businessUnit: { id: string; legalName: string; tradeName: string | null };
}

interface RoleSource {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: readonly string[];
  allowedSurfaces: readonly string[];
  isSystem: boolean;
  organizationId: string | null;
  _count: { organizationMemberships: number };
}

@Injectable()
export class OrganizationReadModelMapper {
  context(source: OrganizationSource): OrganizationContextReadModel {
    return {
      id: source.id,
      ownerUserId: source.ownerUserId,
      planId: source.planId,
      slug: source.slug,
      displayName: source.displayName,
      primarySegment: source.primarySegment,
      status: source.status,
      subscriptionStatus: source.subscriptionStatus,
      subscriptionStartedAt: this.nullableDate(source.subscriptionStartedAt),
      currentPeriodStart: this.nullableDate(source.currentPeriodStart),
      currentPeriodEnd: this.nullableDate(source.currentPeriodEnd),
      /* Igual às unidades: o fato, não a imagem. */
      hasLogo: Boolean(source.logoUrl),
      settings: source.settings,
      createdAt: this.date(source.createdAt),
      updatedAt: this.date(source.updatedAt),
      plan: this.plan(source.plan),
      businessUnits: source.businessUnits.map((unit) =>
        this.businessUnit(unit),
      ),
    };
  }

  businessUnit(source: BusinessUnitSource): BusinessUnitReadModel {
    return {
      id: source.id,
      organizationId: source.organizationId,
      parentId: source.parentId,
      slug: source.slug,
      code: source.code,
      type: source.type,
      isPrimary: source.isPrimary,
      legalName: source.legalName,
      tradeName: source.tradeName,
      documentType: source.documentType,
      documentNumber: source.documentNumber,
      city: source.city,
      street: source.street,
      number: source.number,
      stateCode: source.stateCode,
      postalCode: source.postalCode,
      email: source.email,
      phone: source.phone,
      timezone: source.timezone,
      locale: source.locale,
      currency: source.currency,
      /* Só o fato, não a imagem: a lista de unidades não deve carregar
         centenas de quilobytes por linha. */
      hasLogo: Boolean(source.logoUrl),
      status: source.status,
      createdAt: this.date(source.createdAt),
      updatedAt: this.date(source.updatedAt),
    };
  }

  /**
   * Membros da organização.
   *
   * `ownerUserId` entra como parâmetro porque quem é dono é atributo da
   * organização, não da associação — sem ele o cliente teria de cruzar duas
   * respostas para saber a mesma coisa.
   */
  members(
    sources: readonly MemberSource[],
    ownerUserId: string,
    unitMemberships: readonly UnitMembershipSource[] = [],
  ): readonly OrganizationMemberReadModel[] {
    /**
     * Agrupa as unidades por pessoa uma vez, em vez de varrer a lista inteira
     * para cada membro.
     */
    const byUser = new Map<string, UnitMembershipSource['businessUnit'][]>();
    for (const membership of unitMemberships) {
      const units = byUser.get(membership.userId) ?? [];
      units.push(membership.businessUnit);
      byUser.set(membership.userId, units);
    }

    return sources.map((source) =>
      this.member(source, ownerUserId, byUser.get(source.userId) ?? []),
    );
  }

  member(
    source: MemberSource,
    ownerUserId: string,
    businessUnits: readonly UnitMembershipSource['businessUnit'][] = [],
  ): OrganizationMemberReadModel {
    return {
      userId: source.userId,
      displayName: source.user.displayName,
      email: source.user.email,
      avatarUrl: source.user.avatarUrl,
      /** Status da associação, não da conta: quem saiu não recebe trabalho. */
      status: source.status,
      role: {
        id: source.role.id,
        key: source.role.key,
        name: source.role.name,
      },
      businessUnits: businessUnits.map((unit) => ({ ...unit })),
      joinedAt: this.date(source.joinedAt),
      hasSignature: (source.user.professionalSignatures ?? []).length > 0,
      isOwner: source.userId === ownerUserId,
      access: {
        useRoleDefaults: !source.usesCustomAccess,
        permissions: [
          ...(source.usesCustomAccess
            ? source.customPermissions
            : source.role.permissions),
        ],
        allowedSurfaces: [
          ...(source.usesCustomAccess
            ? source.customAllowedSurfaces
            : source.role.allowedSurfaces),
        ],
      },
    };
  }

  roles(sources: readonly RoleSource[]): readonly OrganizationRoleReadModel[] {
    return sources.map((source) => this.role(source));
  }

  role(source: RoleSource): OrganizationRoleReadModel {
    return {
      id: source.id,
      key: source.key,
      name: source.name,
      description: source.description,
      permissions: [...source.permissions],
      allowedSurfaces: [...source.allowedSurfaces],
      isSystem: source.isSystem,
      isOrganizationOwned: source.organizationId !== null,
      memberCount: source._count.organizationMemberships,
    };
  }

  private plan(source: PlanSource): OrganizationPlanReadModel {
    return {
      id: source.id,
      key: source.key,
      name: source.name,
      description: source.description,
      monthlyPrice: this.decimal(source.monthlyPrice),
      annualPrice: this.decimal(source.annualPrice),
      currency: source.currency,
      capabilities: [...source.capabilities],
      limits: this.limits(source.limits),
      isActive: source.isActive,
    };
  }

  private limits(value: unknown): Readonly<Record<string, number | null>> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, number | null>)
      : {};
  }

  private decimal(value: DecimalValue): string | number | null {
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'string'
    )
      return value;
    return value.toString();
  }

  private date(value: DateValue): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private nullableDate(value: DateValue | null): string | null {
    return value === null ? null : this.date(value);
  }
}
