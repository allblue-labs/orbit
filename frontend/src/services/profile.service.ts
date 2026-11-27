/**
 * Serviços de Perfil.
 *
 * Espelho de `identity/me`. Tudo aqui é do **usuário autenticado** — nenhuma
 * rota aceita `userId`, e é isso que separa Perfil de Workforce: lá se
 * administra a equipe, aqui a própria conta.
 *
 * ## Não é autenticação
 *
 * Login, refresh e logout continuam nas rotas dedicadas (`/api/auth/*`), com
 * os cookies `HttpOnly` que o BFF gerencia. Aqui há leitura de perfil, troca
 * de senha (que exige a atual), sessões e MFA — administração de conta, não
 * emissão de token.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { RequestOptions } from "@/types/api";
import type {
  ChangePasswordInput,
  DeviceSession,
  EnableMfaInput,
  MfaEnrollment,
  UpdateProfileInput,
  UserProfile,
} from "@/types/settings";

const RESOURCE = "identity-profile";
const BASE_PATH = "/identity/me";

export const profileService = {
  get: (options?: RequestOptions): Promise<UserProfile> =>
    apiClient.get<UserProfile>(BASE_PATH, options),

  update: (input: UpdateProfileInput): Promise<UserProfile> =>
    apiClient.patch<UserProfile>(BASE_PATH, input),

  /**
   * Troca a própria senha.
   *
   * O servidor revoga as demais sessões e mantém a atual — quem trocou não é
   * expulso, quem estava com a senha antiga sai.
   */
  changePassword: (input: ChangePasswordInput): Promise<void> =>
    apiClient.post<void>(`${BASE_PATH}/password`, input),

  sessions: (options?: RequestOptions): Promise<DeviceSession[]> =>
    apiClient.get<DeviceSession[]>(`${BASE_PATH}/sessions`, options),

  revokeSession: (id: string): Promise<void> =>
    apiClient.delete<void>(`${BASE_PATH}/sessions/${encodeURIComponent(id)}`),

  /** Começa o cadastro de MFA: devolve segredo e `otpauth://` para o QR. */
  beginMfaEnrollment: (): Promise<MfaEnrollment> =>
    apiClient.post<MfaEnrollment>(`${BASE_PATH}/mfa/enrollment`, {}),

  enableMfa: (
    input: EnableMfaInput,
    headers: Record<string, string>,
  ): Promise<{ recoveryCodes: string[] }> =>
    apiClient.post<{ recoveryCodes: string[] }>(
      `${BASE_PATH}/mfa/enable`,
      input,
      {
        headers,
        retries: 0,
      },
    ),

  disableMfa: (headers: Record<string, string>): Promise<void> =>
    apiClient.delete<void>(`${BASE_PATH}/mfa`, { headers, retries: 0 }),

  keys: {
    module: (): QueryKey => queryKeys.module(RESOURCE),
    profile: (): QueryKey => queryKeys.query(RESOURCE, "profile"),
    sessions: (): QueryKey => queryKeys.query(RESOURCE, "sessions"),
  },
} as const;
