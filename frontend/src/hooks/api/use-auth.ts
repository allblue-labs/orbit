"use client";

/**
 * Autenticação no browser.
 *
 * Encapsula as chamadas ao BFF, a sincronização do cache e a navegação — as
 * telas só disparam `login.mutate(...)` e tratam `error`/`isPending`.
 *
 * O destino após autenticar não é fixo: depende do tipo de conta. Um Platform
 * Administrator não tem organização e as rotas de tenant recusariam suas
 * requisições, então ele vai para o painel da plataforma.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { queryKeys } from "@/api/query-keys";
import { ROUTES, homeRouteFor } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import {
  authService,
  type AuthResult,
  type RegistrationResult,
} from "@/services/auth.service";
import { ROUTE_ASSINATURA } from "@/components/billing/subscription-access";
import { requiresInitialPayment } from "@/components/billing/billing-session";
import type {
  AcceptInvitationInput,
  ForgotPasswordInput,
  LoginInput,
  PublicPlan,
  RegisterInput,
  ResetPasswordInput,
  SessionState,
} from "@/types/session";
import { useApiMutation } from "./use-api-mutation";
import { useApiQuery } from "./use-api-query";

export interface AuthNavigationOptions {
  /** Destino após o sucesso. Padrão: home do tipo de conta autenticada. */
  redirectTo?: string;
}

/**
 * Recarrega a sessão e navega para o destino correto.
 *
 * `fetchQuery` popula o cache e devolve o estado na mesma chamada, evitando
 * decidir o redirecionamento com a sessão anterior (ainda anônima).
 */
function useAuthenticatedRedirect(redirectTo?: string) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useCallback(async () => {
    const state = await queryClient.fetchQuery<SessionState>({
      queryKey: queryKeys.session(),
      queryFn: () => authService.session(),
      staleTime: 0,
    });
    const destination = requiresInitialPayment(state)
      ? ROUTE_ASSINATURA
      : (redirectTo ??
        homeRouteFor({
          isPlatformAdmin: state.authenticated && state.isPlatformAdmin,
        }));
    router.replace(destination);
    router.refresh();
  }, [queryClient, redirectTo, router]);
}

export function useLogin(options: AuthNavigationOptions = {}) {
  const redirect = useAuthenticatedRedirect(options.redirectTo);

  return useApiMutation<AuthResult, LoginInput>(
    (input) => authService.login(input),
    { onSuccess: redirect },
  );
}

export function useRegister() {
  const session = useSession();
  return useApiMutation<RegistrationResult, RegisterInput>(
    (input) => authService.register(input),
    {
      onSuccess: () => {
        session.clear();
      },
    },
  );
}

export function useLogout(options: { redirectTo?: string } = {}) {
  const router = useRouter();
  const session = useSession();
  const redirectTo = options.redirectTo ?? ROUTES.login;

  const finish = useCallback(() => {
    session.clear();
    router.replace(redirectTo);
    router.refresh();
  }, [redirectTo, router, session]);

  return useApiMutation<AuthResult, void>(() => authService.logout(), {
    onSuccess: finish,
    /** Falha ao revogar no backend não deve prender o usuário na sessão. */
    onError: finish,
  });
}

/**
 * Solicita o e-mail de recuperação de senha.
 *
 * O backend responde igual para e-mail existente ou não — a tela deve mostrar
 * sempre a mesma confirmação.
 */
export function useForgotPassword() {
  return useApiMutation<void, ForgotPasswordInput>((input) =>
    authService.forgotPassword(input),
  );
}

/** Define a nova senha a partir do token recebido por e-mail. */
export function useResetPassword(
  options: { redirectTo?: string | false } = {},
) {
  const router = useRouter();
  const redirectTo = options.redirectTo ?? ROUTES.login;

  return useApiMutation<void, ResetPasswordInput>(
    (input) => authService.resetPassword(input),
    {
      onSuccess: () => {
        if (redirectTo !== false) router.replace(redirectTo);
      },
    },
  );
}

/** Aceita o convite, criando a credencial do usuário convidado. */
export function useAcceptInvitation(options: { redirectTo?: string } = {}) {
  const router = useRouter();
  const redirectTo = options.redirectTo ?? ROUTES.login;

  return useApiMutation<void, AcceptInvitationInput>(
    (input) => authService.acceptInvitation(input),
    {
      onSuccess: () => {
        router.replace(redirectTo);
      },
    },
  );
}

/** Planos publicados (`GET /plans`, rota pública). */
export function usePlans() {
  return useApiQuery<readonly PublicPlan[]>(
    queryKeys.query("plans", "public"),
    () => authService.listPlans(),
    { staleTime: 5 * 60_000 },
  );
}
