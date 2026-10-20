/**
 * Contratos do Workforce Management.
 *
 * Reúne os três contratos que descrevem a equipe — membros, convites e
 * papéis — sem redeclarar nenhum: todos vêm dos Read Models sincronizados.
 *
 * ## Não substitui autenticação
 *
 * Aqui não há login, sessão, MFA nem senha. `identity/me` e `identity/sessions`
 * continuam sendo do domínio de autenticação; este módulo é **gestão
 * operacional da equipe** — quem faz parte, com que papel, em que unidade, e o
 * que cada pessoa tem para fazer.
 */
import type {
  OrganizationMemberReadModel,
  OrganizationRoleReadModel,
} from "./contracts/modules/organizations/organization.read-models";
import type {
  EligibleProfessionalReadModel,
  MemberCertificationReadModel,
  MemberLocationReadModel,
  MemberSpecialtyReadModel,
  ProfessionalCredentialReadModel,
  ProfessionalEligibilityBlockedReason,
  ProfessionalEligibilityReadModel,
  ProfessionalProfileReadModel,
  PublicProfessionalRole,
  SpecialtyReadModel,
  TeamReadModel,
} from "./contracts/modules/workforce/workforce.read-models";
import type { InvitationStatus } from "./contracts";

export type { InvitationStatus };

/** Membro da organização (`GET /organizations/current/members`). */
export type TeamMember = OrganizationMemberReadModel;

/** Papel e o que ele concede (`GET /organizations/current/roles`). */
export type TeamRole = OrganizationRoleReadModel;

/**
 * Convite (`GET /identity/invitations`).
 *
 * Espelhado do `InvitationReadModel` do backend. **Não há token** — nem em
 * claro nem em hash: ele é entregue uma vez, por e-mail, e reexpô-lo daria a
 * qualquer gestor a capacidade de aceitar o convite no lugar da pessoa.
 */
export interface TeamInvitation {
  id: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
  role: { id: string; key: string; name: string };
  businessUnit: {
    id: string;
    legalName: string;
    tradeName: string | null;
  } | null;
  invitedBy: { id: string; displayName: string } | null;
}

/** `GET /identity/invitations` (`InvitationQueryDto`). */
export interface InvitationQuery {
  status?: InvitationStatus;
  search?: string;
  page?: number;
  limit?: number;
}

/** `GET /organizations/current/members` (`MemberQueryDto`). */
export interface MemberQuery {
  page?: number;
  limit?: number;
}

/**
 * `PATCH /organizations/current/members/:userId` (`UpdateMemberDto`).
 *
 * Só papel e situação. Nome, e-mail e avatar são do **perfil**, que cada
 * pessoa administra em `identity/me` — um gestor não edita a identidade de
 * outro.
 */
export interface UpdateMemberInput {
  roleId?: string;
  status?: MembershipStatus;
  businessUnitIds?: string[];
  useRoleDefaults?: boolean;
  permissions?: string[];
  allowedSurfaces?: string[];
}

export interface AccessCatalog {
  surfaces: readonly { code: string; label: string }[];
  permissionGroups: readonly {
    key: string;
    label: string;
    permissions: readonly { code: string; label: string }[];
  }[];
}

/** Situação de uma associação, como o backend a define. */
export const MembershipStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;
export type MembershipStatus =
  (typeof MembershipStatus)[keyof typeof MembershipStatus];

/** `POST /organizations/current/roles` (`CreateRoleDto`). */
export interface CreateRoleInput {
  name: string;
  description?: string;
  permissions?: string[];
  /**
   * Onde o papel entra: `WEB`, `MOBILE`, `API`.
   *
   * Omitido, o backend concede os dois — o padrão de todo papel antes de a
   * separação existir. Ao menos uma superfície, ou a criação é recusada.
   */
  allowedSurfaces?: string[];
}

export type UpdateRoleInput = Partial<CreateRoleInput>;

/* ------------------------------------------------------------------ */
/* Workforce — especialidades, certificações, equipes, geolocalização   */
/* ------------------------------------------------------------------ */

export type Specialty = SpecialtyReadModel;
export type MemberSpecialty = MemberSpecialtyReadModel;
export type MemberCertification = MemberCertificationReadModel;
export type Team = TeamReadModel;
export type MemberLocation = MemberLocationReadModel;

/** Nível declarado — quem define é a organização, nada é inferido. */
export const SpecialtyLevel = {
  JUNIOR: "JUNIOR",
  PLENO: "PLENO",
  SENIOR: "SENIOR",
  ESPECIALISTA: "ESPECIALISTA",
} as const;
export type SpecialtyLevel =
  (typeof SpecialtyLevel)[keyof typeof SpecialtyLevel];

/**
 * Situação do vencimento — **resolvida no servidor**.
 *
 * O cliente não compara datas para decidir se alguém está habilitado: um
 * navegador com relógio errado não pode transformar um técnico vencido em
 * habilitado.
 */
export const CertificationExpiryStatus = {
  VALID: "VALID",
  EXPIRING: "EXPIRING",
  EXPIRED: "EXPIRED",
  PERMANENT: "PERMANENT",
} as const;
export type CertificationExpiryStatus =
  (typeof CertificationExpiryStatus)[keyof typeof CertificationExpiryStatus];

export interface CreateSpecialtyInput {
  name: string;
  description?: string;
  color?: string;
}
export type UpdateSpecialtyInput = Partial<CreateSpecialtyInput>;

export interface AssignSpecialtyInput {
  specialtyId: string;
  level?: SpecialtyLevel;
  notes?: string;
}

export interface CreateCertificationInput {
  name: string;
  issuer?: string;
  credentialId?: string;
  issuedAt?: string;
  expiresAt?: string;
  fileId?: string;
  notes?: string;
}
export type UpdateCertificationInput = Partial<CreateCertificationInput>;

export interface CertificationQuery {
  userId?: string;
  expiringWithinDays?: number;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
  color?: string;
  businessUnitId?: string;
  leaderUserId?: string;
}
export interface UpdateTeamInput extends Partial<CreateTeamInput> {
  status?: "ACTIVE" | "INACTIVE";
}

export interface AddTeamMemberInput {
  userId: string;
  role?: string;
}

/**
 * `POST /workforce/me/location`.
 *
 * Sem `userId`: quem reporta é quem está autenticado. Publicar a posição de
 * outro seria vigilância por procuração, e o contrato não a permite.
 */
export interface ReportLocationInput {
  latitude: number;
  longitude: number;
  accuracy?: number;
  source?: "MOBILE" | "WEB" | "MANUAL";
  recordedAt?: string;
}

/** `POST /identity/invitations` (`CreateInvitationDto`). */
export interface CreateInvitationInput {
  email: string;
  roleId: string;
  businessUnitId?: string;
}

/**
 * O que o contrato de equipe **não** tem, e que a tela por isso não inventa:
 *
 * - **edição de perfil por terceiro** — nome, e-mail e avatar são do domínio
 *   de perfil, que cada pessoa administra em `identity/me`. `PATCH` de membro
 *   altera apenas papel e situação;
 * - **produtividade por pessoa** — o Analytics publica `technicians.active` e
 *   `technicians.assignment_coverage`, ambos da organização. Carga é quanto há
 *   para fazer; produtividade seria quanto se fez por tempo, e ninguém mediu;
 * - **presença em tempo real** — `GET /workforce/locations` devolve a última
 *   posição *reportada*, com a idade junto. Silêncio não é ausência;
 * - **IA por pessoa** — `AiExecutionQueryDto` não aceita `userId`;
 * - **edição de papéis de sistema** — `isSystem` os protege, e o servidor
 *   recusa.
 */
export const WORKFORCE_CONTRACT_GAPS = [
  "profileEditByOthers",
  "perUserProductivity",
  "realtimePresence",
  "intelligence",
] as const;

/* ------------------------------------------------------------------ */
/* Domínio profissional (PR-27)                                        */
/* ------------------------------------------------------------------ */

/**
 * Papel profissional ≠ papel de acesso.
 *
 * `TeamRole` é RBAC — o que a pessoa pode fazer no sistema.
 * `PublicProfessionalRole` é ofício — o que ela faz em campo. Os dois tipos
 * ficam separados de propósito: um `string` compartilhado convidaria a
 * confundi-los na primeira tela apressada.
 */
export type ProfessionalRole = PublicProfessionalRole;
export type ProfessionalCredential = ProfessionalCredentialReadModel;
export type ProfessionalProfile = ProfessionalProfileReadModel;

/**
 * `PATCH /workforce/members/:userId/professional-profile`
 * (`UpdateProfessionalProfileDto`).
 *
 * Os dois papéis viajam juntos porque o contrato os substitui: enviar só um
 * apagaria o outro. Quem monta a requisição parte do estado atual.
 */
export interface UpdateProfessionalProfileInput {
  fieldTechnicianEnabled: boolean;
  technicalResponsibleEnabled: boolean;
  active?: boolean;
}
export type ProfessionalEligibility = ProfessionalEligibilityReadModel;
export type BlockedReason = ProfessionalEligibilityBlockedReason;

/**
 * Um candidato de seletor.
 *
 * Já vem filtrado pelo servidor — perfil ativo, papel habilitado, usuário
 * ativo na organização e no escopo da unidade. A tela **não** refiltra.
 */
export type EligibleProfessional = EligibleProfessionalReadModel;

/** `?businessUnitId=` — recorta os candidatos pela unidade do atendimento. */
export interface ProfessionalSelectorQuery {
  businessUnitId?: string;
}

/** `GET /workforce/members/:userId/document-eligibility`. */
export interface ProfessionalEligibilityQuery {
  documentType: string;
  signedAs: ProfessionalRole;
  businessUnitId?: string;
}

/* ------------------------------------------------------------------ */
/* Cadastro de pessoas                                                 */
/* ------------------------------------------------------------------ */

/** `POST /organizations/current/team/members`. */
export interface CreateTeamMemberInput {
  email: string;
  firstName: string;
  lastName: string;
  /** Um papel **atribuível** da organização — `OWNER` é recusado. */
  roleId: string;
  /** Omitido, a pessoa entra na unidade principal. */
  businessUnitId?: string;
  /** Escopo operacional explícito. Ao menos uma unidade é obrigatória na UI. */
  businessUnitIds?: string[];
  /** Mantém o acesso sincronizado com o papel escolhido. */
  useRoleDefaults?: boolean;
  /** Override opcional; sempre validado e limitado pelo servidor. */
  permissions?: string[];
  allowedSurfaces?: string[];
}

/**
 * A resposta do cadastro.
 *
 * `temporaryPassword` existe **só aqui**. Nenhuma consulta a devolve e não há
 * onde relê-la: a tela precisa mostrá-la antes de fechar, e dizer isso.
 */
export interface CreatedTeamMember {
  member: TeamMember;
  temporaryPassword: string;
}

/**
 * O link de definição de senha que o owner repassa.
 *
 * `emailSent` diz se o servidor conseguiu mandar por e-mail — quando não, é o
 * link na mão do owner que resolve, por WhatsApp, Telegram ou o que a pessoa
 * usar.
 */
export interface TeamPasswordLink {
  link: string;
  expiresAt: string;
  emailSent: boolean;
  member: TeamMember;
}
