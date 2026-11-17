/**
 * Serviço de autenticação.
 *
 * Duas superfícies, ambas no BFF:
 *
 * - `/api/auth/*` — fluxos que emitem ou revogam tokens. Gravam cookies
 *   `HttpOnly` e devolvem apenas o estado da sessão.
 * - `/api/orbit/*` — rotas públicas do NestJS (`@Public()`) encaminhadas pelo
 *   proxy sem sessão: planos, recuperação de senha e aceite de convite.
 *
 * Nenhum token trafega até o browser em qualquer um dos caminhos.
 */
import type { IdentityRegistrationReadModel } from "@/types/contracts/modules/identity/identity.read-models";
import { apiClient, authClient } from "@/api/client";
import type {
  AcceptInvitationInput,
  ForgotPasswordInput,
  LoginInput,
  PublicPlan,
  RegisterInput,
  ResetPasswordInput,
  SessionState,
} from "@/types/session";

export interface AuthResult {
  authenticated: boolean;
}

export interface RegistrationResult extends IdentityRegistrationReadModel {
  authenticated: false;
}

export const authService = {
  login: (input: LoginInput): Promise<AuthResult> =>
    authClient.post<AuthResult>("/login", input),

  register: (input: RegisterInput): Promise<RegistrationResult> =>
    authClient.post<RegistrationResult>("/register", input),

  logout: (): Promise<AuthResult> => authClient.post<AuthResult>("/logout"),

  /** Força a rotação do par de tokens. */
  refresh: (): Promise<AuthResult> => authClient.post<AuthResult>("/refresh"),

  session: (): Promise<SessionState> =>
    authClient.get<SessionState>("/session"),

  /**
   * Dispara o e-mail de recuperação.
   *
   * O backend responde 202 mesmo quando a conta não existe, para não revelar
   * quais e-mails estão cadastrados — a tela deve dar sempre a mesma resposta.
   */
  forgotPassword: (input: ForgotPasswordInput): Promise<void> =>
    apiClient.post<void>("/identity/password/forgot", input, { retries: 0 }),

  /** Consome o token do e-mail e grava a nova senha (204). */
  resetPassword: (input: ResetPasswordInput): Promise<void> =>
    apiClient.post<void>("/identity/password/reset", input, { retries: 0 }),

  /** Aceita o convite e cria a credencial do usuário convidado (204). */
  acceptInvitation: (input: AcceptInvitationInput): Promise<void> =>
    apiClient.post<void>("/identity/invitations/accept", input, { retries: 0 }),

  /** Planos publicados, usados na escolha do plano durante o onboarding. */
  listPlans: (): Promise<readonly PublicPlan[]> =>
    apiClient.get<readonly PublicPlan[]>("/plans"),
} as const;
