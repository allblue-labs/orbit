/**
 * Contratos de Configurações e Perfil.
 *
 * ## A divisão que dá nome aos dois Workspaces
 *
 * **Configurações** administram a plataforma: o que vale para toda a
 * organização. **Perfil** administra o usuário autenticado: o que vale só para
 * quem está olhando.
 *
 * A fronteira é o `userId`. Tudo em `identity/me` é perfil — inclusive as
 * sessões, que são os dispositivos daquela pessoa. Tudo em
 * `organizations/current` é configuração.
 *
 * A exceção aparente são as **preferências de notificação**: o contrato é
 * `@@unique([organizationId, userId, type])`, ou seja, são pessoais **dentro
 * de uma organização**. Ficam nas duas telas por razões diferentes — em
 * Configurações porque é lá que se administra o canal, em Perfil porque a
 * escolha é de quem recebe.
 */
import type {
  IdentityDeviceSessionReadModel,
  IdentityProfileReadModel,
} from "./contracts/modules/identity/identity.read-models";
import type { NotificationChannel } from "./contracts";

export type { NotificationChannel };

/** `GET /identity/me`. */
export type UserProfile = IdentityProfileReadModel;

/** `GET /identity/me/sessions` — um dispositivo autenticado. */
export type DeviceSession = IdentityDeviceSessionReadModel;

/**
 * `PATCH /identity/me` (`UpdateProfileDto`).
 *
 * O que o contrato **não** aceita, verificado: `theme` e `avatarUrl` são
 * recusados por `forbidNonWhitelisted`. `avatarUrl` é publicado na leitura,
 * mas escrito só internamente — não há upload de foto.
 */
export interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  locale?: string;
  timezone?: string;
}

/**
 * `POST /identity/me/password` (`ChangePasswordDto`).
 *
 * `currentPassword` é obrigatória: é o que separa este fluxo do de recuperação
 * por e-mail, que existe para quem **não** tem a senha atual.
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** Início do cadastro de MFA (`POST /identity/me/mfa/enrollment`). */
export interface MfaEnrollment {
  factorId: string;
  /** Segredo em base32, para quem digita à mão. */
  secret: string;
  /** `otpauth://` — o conteúdo do QR Code. */
  uri: string;
  /**
   * O QR já desenhado, como data URI de SVG.
   *
   * Vem pronto do servidor: gerar no navegador exigiria uma biblioteca de
   * renderização, e o código **é** a mesma URI que já está acima — não há
   * nada exposto a mais.
   */
  qrCode: string;
}

export interface EnableMfaInput {
  factorId: string;
  code: string;
}

/**
 * Preferência de notificação (`GET/PATCH /notifications/preferences`).
 *
 * `type` é texto livre no DTO — não há catálogo de eventos no backend, e é por
 * isso que a tela lista os tipos que **já têm** preferência somados aos que o
 * literal `NotificationType` declara, em vez de inventar uma lista fixa.
 */
export interface NotificationPreference {
  id: string;
  organizationId: string;
  userId: string;
  type: string;
  channels: readonly string[];
  enabled: boolean;
  quietHours: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateNotificationPreferenceInput {
  type: string;
  enabled: boolean;
  channels: string[];
  quietHours?: Record<string, unknown>;
}

/** Canais que o `NotificationPreferenceDto` aceita — `SMS` não entra. */
export const PREFERENCE_CHANNELS = [
  "IN_APP",
  "REALTIME",
  "EMAIL",
  "PUSH",
] as const;
export type PreferenceChannel = (typeof PREFERENCE_CHANNELS)[number];

/** Limites declarados pelo `class-validator`. */
export const PROFILE_LIMITS = {
  nameMaxLength: 120,
  displayNameMaxLength: 180,
  phoneMaxLength: 32,
  localeMaxLength: 16,
  timezoneMaxLength: 64,
  passwordMinLength: 12,
  passwordMaxLength: 128,
} as const;

/**
 * O que os contratos de configuração e perfil **não** têm:
 *
 * - **tema** — `PATCH /identity/me` recusa `theme`, e a aplicação não tem
 *   alternância de tema implementada. Guardar a escolha localmente seria a
 *   "configuração paralela" que o enunciado proíbe;
 * - **foto de perfil** — `avatarUrl` é publicado, não editável; não há upload;
 * - **histórico de acesso** — não há rota de auditoria por usuário
 *   (`/identity/me/audit` e `/login-history` → 404). `Session.createdAt` conta
 *   quando cada dispositivo entrou, e é o que a tela mostra;
 * - **API Keys e Webhooks** — não existem (`/api-keys`, `/webhooks` → 404);
 * - **SSO** — não há provedor de identidade externo em contrato;
 * - **políticas de segurança configuráveis** — expiração de sessão, tentativas
 *   e bloqueio são decididos pelo servidor e não publicados;
 * - **settings estruturado** — `Organization.settings` é `Json?` livre, sem
 *   esquema. Ver `docs/settings-workspace.md`.
 */
export const SETTINGS_CONTRACT_GAPS = [
  "theme",
  "avatarUpload",
  "accessHistory",
  "apiKeys",
  "webhooks",
  "sso",
  "securityPolicies",
  "structuredSettings",
] as const;
