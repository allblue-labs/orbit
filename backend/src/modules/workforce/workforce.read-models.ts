/**
 * Read Models do Workforce.
 *
 * Complementam `OrganizationMemberReadModel`, que responde "quem faz parte e
 * com que papel", com o que a operação de campo precisa: o que a pessoa sabe
 * fazer, o que está habilitada a fazer, com quem trabalha e onde esteve.
 */

export interface SpecialtyReadModel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  /** Quantas pessoas têm esta especialidade. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemberSpecialtyReadModel {
  id: string;
  userId: string;
  level: string;
  notes: string | null;
  specialty: { id: string; name: string; slug: string; color: string | null };
}

/**
 * Certificação de uma pessoa.
 *
 * `expiryStatus` é calculado **no servidor**, comparando `expiresAt` com a data
 * da consulta. O cliente não compara datas para decidir se alguém está
 * habilitado — essa é a resposta que o backend dá.
 */
export interface MemberCertificationReadModel {
  id: string;
  userId: string;
  name: string;
  issuer: string | null;
  credentialId: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  /** `VALID` · `EXPIRING` (30 dias) · `EXPIRED` · `PERMANENT` (sem prazo). */
  expiryStatus: string;
  /** Dias até vencer; negativo quando já venceu; `null` sem prazo. */
  daysUntilExpiry: number | null;
  fileId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberReadModel {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: string | null;
  joinedAt: string;
}

export interface TeamReadModel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  status: string;
  businessUnit: {
    id: string;
    legalName: string;
    tradeName: string | null;
  } | null;
  leader: { userId: string; displayName: string } | null;
  members: readonly TeamMemberReadModel[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Última posição conhecida de uma pessoa.
 *
 * `ageMinutes` acompanha a coordenada porque uma posição sem idade engana:
 * "onde ele está" e "onde ele esteve há seis horas" parecem iguais no mapa.
 */
export interface MemberLocationReadModel {
  userId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  source: string;
  recordedAt: string;
  ageMinutes: number;
}

export type PublicProfessionalRole =
  'FIELD_TECHNICIAN' | 'TECHNICAL_RESPONSIBLE';

export interface ProfessionalCredentialReadModel {
  id: string;
  type: 'CREA' | 'CFT' | 'CRT' | 'OTHER';
  registrationNumber: string;
  region: string | null;
  issuingAuthority: string | null;
  displayLabel: string | null;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export interface ProfessionalProfileReadModel {
  id: string;
  userId: string;
  displayName: string;
  professionalRoles: readonly PublicProfessionalRole[];
  active: boolean;
  signatureAvailable: boolean;
  professionalCredentials: readonly ProfessionalCredentialReadModel[];
  createdAt: string;
  updatedAt: string;
}

/** Contrato mínimo para seletores. Nunca publica asset, e-mail ou RBAC. */
export interface EligibleProfessionalReadModel {
  id: string;
  name: string;
  signatureAvailable: boolean;
  professionalCredential: ProfessionalCredentialReadModel | null;
  active: boolean;
}

export type ProfessionalEligibilityBlockedReason =
  | 'PROFESSIONAL_PROFILE_INACTIVE'
  | 'PROFESSIONAL_ROLE_MISSING'
  | 'SIGNATURE_MISSING'
  | 'BUSINESS_UNIT_SCOPE_MISSING'
  | 'DOCUMENT_POLICY_DENIED';

export interface ProfessionalEligibilityReadModel {
  userId: string;
  documentType: string;
  signedAs: PublicProfessionalRole;
  eligible: boolean;
  blockedReason: ProfessionalEligibilityBlockedReason | null;
  signatureAvailable: boolean;
}
