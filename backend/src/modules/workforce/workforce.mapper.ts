import { Injectable } from '@nestjs/common';
import type {
  MemberCertificationReadModel,
  MemberLocationReadModel,
  MemberSpecialtyReadModel,
  SpecialtyReadModel,
  TeamReadModel,
  ProfessionalProfileReadModel,
  ProfessionalCredentialReadModel,
} from './workforce.read-models';

const DAY_MS = 24 * 60 * 60_000;
/** Janela em que uma certificação já merece atenção. */
const EXPIRING_WINDOW_DAYS = 30;

type DateValue = Date | string;
/** O Prisma devolve `Decimal` para colunas numéricas; só precisamos convertê-lo. */
type DecimalValue = { toString(): string } | number | string;

@Injectable()
export class WorkforceMapper {
  professionalCredential(source: {
    id: string;
    type: string;
    registrationNumber: string;
    region: string | null;
    issuingAuthority: string | null;
    displayLabel: string | null;
    active: boolean;
    createdAt: DateValue;
    revokedAt: DateValue | null;
  }): ProfessionalCredentialReadModel {
    return {
      id: source.id,
      type: source.type as ProfessionalCredentialReadModel['type'],
      registrationNumber: source.registrationNumber,
      region: source.region,
      issuingAuthority: source.issuingAuthority,
      displayLabel: source.displayLabel,
      active: source.active,
      createdAt: this.date(source.createdAt),
      revokedAt: source.revokedAt ? this.date(source.revokedAt) : null,
    };
  }

  professionalProfile(
    source: {
      id: string;
      userId: string;
      fieldTechnicianEnabled: boolean;
      technicalResponsibleEnabled: boolean;
      active: boolean;
      createdAt: DateValue;
      updatedAt: DateValue;
      user: { displayName: string };
      credentials: readonly Parameters<
        WorkforceMapper['professionalCredential']
      >[0][];
    },
    signatureAvailable: boolean,
  ): ProfessionalProfileReadModel {
    return {
      id: source.id,
      userId: source.userId,
      displayName: source.user.displayName,
      professionalRoles: [
        ...(source.fieldTechnicianEnabled ? ['FIELD_TECHNICIAN' as const] : []),
        ...(source.technicalResponsibleEnabled
          ? ['TECHNICAL_RESPONSIBLE' as const]
          : []),
      ],
      active: source.active,
      signatureAvailable,
      professionalCredentials: source.credentials.map((item) =>
        this.professionalCredential(item),
      ),
      createdAt: this.date(source.createdAt),
      updatedAt: this.date(source.updatedAt),
    };
  }
  specialty(source: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    color: string | null;
    createdAt: DateValue;
    updatedAt: DateValue;
    _count: { members: number };
  }): SpecialtyReadModel {
    return {
      id: source.id,
      name: source.name,
      slug: source.slug,
      description: source.description,
      color: source.color,
      memberCount: source._count.members,
      createdAt: this.date(source.createdAt),
      updatedAt: this.date(source.updatedAt),
    };
  }

  memberSpecialty(source: {
    id: string;
    userId: string;
    level: string;
    notes: string | null;
    specialty: { id: string; name: string; slug: string; color: string | null };
  }): MemberSpecialtyReadModel {
    return { ...source };
  }

  /**
   * Certificação, com o vencimento **resolvido no servidor**.
   *
   * O cliente não compara datas para decidir se alguém está habilitado: essa é
   * a resposta que o backend dá, com o mesmo relógio para todos. Um navegador
   * com data errada não pode transformar um técnico vencido em habilitado.
   */
  certification(source: {
    id: string;
    userId: string;
    name: string;
    issuer: string | null;
    credentialId: string | null;
    issuedAt: Date | null;
    expiresAt: Date | null;
    fileId: string | null;
    notes: string | null;
    createdAt: DateValue;
    updatedAt: DateValue;
  }): MemberCertificationReadModel {
    const days = source.expiresAt
      ? Math.ceil((source.expiresAt.getTime() - Date.now()) / DAY_MS)
      : null;

    return {
      id: source.id,
      userId: source.userId,
      name: source.name,
      issuer: source.issuer,
      credentialId: source.credentialId,
      issuedAt: source.issuedAt?.toISOString() ?? null,
      expiresAt: source.expiresAt?.toISOString() ?? null,
      expiryStatus:
        days === null
          ? 'PERMANENT'
          : days < 0
            ? 'EXPIRED'
            : days <= EXPIRING_WINDOW_DAYS
              ? 'EXPIRING'
              : 'VALID',
      daysUntilExpiry: days,
      fileId: source.fileId,
      notes: source.notes,
      createdAt: this.date(source.createdAt),
      updatedAt: this.date(source.updatedAt),
    };
  }

  team(source: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    color: string | null;
    status: string;
    createdAt: DateValue;
    updatedAt: DateValue;
    businessUnit: {
      id: string;
      legalName: string;
      tradeName: string | null;
    } | null;
    leader: { id: string; displayName: string } | null;
    members: readonly {
      userId: string;
      role: string | null;
      joinedAt: DateValue;
      user: {
        id: string;
        displayName: string;
        email: string;
        avatarUrl: string | null;
      };
    }[];
  }): TeamReadModel {
    return {
      id: source.id,
      name: source.name,
      slug: source.slug,
      description: source.description,
      color: source.color,
      status: source.status,
      businessUnit: source.businessUnit,
      leader: source.leader
        ? { userId: source.leader.id, displayName: source.leader.displayName }
        : null,
      members: source.members.map((membership) => ({
        userId: membership.userId,
        displayName: membership.user.displayName,
        email: membership.user.email,
        avatarUrl: membership.user.avatarUrl,
        role: membership.role,
        joinedAt: this.date(membership.joinedAt),
      })),
      memberCount: source.members.length,
      createdAt: this.date(source.createdAt),
      updatedAt: this.date(source.updatedAt),
    };
  }

  /**
   * Posição com a idade junto.
   *
   * Uma coordenada sem idade engana: "onde ele está" e "onde ele esteve há seis
   * horas" parecem iguais no mapa. `ageMinutes` é calculado aqui, com o relógio
   * do servidor, pelo mesmo motivo do vencimento de certificação.
   */
  location(source: {
    userId: string;
    latitude: DecimalValue;
    longitude: DecimalValue;
    accuracy: DecimalValue | null;
    source: string;
    recordedAt: Date;
    user: { displayName: string };
  }): MemberLocationReadModel {
    return {
      userId: source.userId,
      displayName: source.user.displayName,
      latitude: Number(source.latitude),
      longitude: Number(source.longitude),
      accuracy: source.accuracy === null ? null : Number(source.accuracy),
      source: source.source,
      recordedAt: source.recordedAt.toISOString(),
      ageMinutes: Math.max(
        0,
        Math.round((Date.now() - source.recordedAt.getTime()) / 60_000),
      ),
    };
  }

  private date(value: DateValue): string {
    return value instanceof Date ? value.toISOString() : value;
  }
}
