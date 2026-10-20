"use client";

/**
 * Sessão no browser.
 *
 * Busca `/api/auth/session` (que lê os cookies `HttpOnly` no servidor) e expõe
 * tudo que a aplicação precisa saber sobre quem está logado: perfil, escopo,
 * papéis, permissões, organização ativa, unidades, plano e módulos
 * habilitados. Tokens nunca chegam até aqui.
 *
 * É a **única** fonte de sessão do frontend — nenhum módulo deve refazer
 * essas chamadas.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

import { authClient } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import type {
  AuthenticatedSession,
  SessionBusinessUnit,
  SessionEntitlements,
  SessionOrganization,
  SessionOrganizationRef,
  SessionScope,
  SessionState,
  SessionUser,
} from "@/types/session";
import { ANONYMOUS_SESSION } from "@/types/session";

/** `*` concede todas as permissões (mesma regra do `PermissionGuard`). */
const WILDCARD_PERMISSION = "*";

export interface SessionContextValue {
  session: SessionState;
  user: SessionUser | null;
  scope: SessionScope;
  roles: readonly string[];
  permissions: readonly string[];
  /** Organização ativa. `null` para Platform Administrator. */
  organization: SessionOrganization | null;
  /** Unidades da organização ativa. */
  businessUnits: readonly SessionBusinessUnit[];
  /** Organizações acessíveis pela sessão. */
  organizations: readonly SessionOrganizationRef[];
  /** Plano e limites vigentes. */
  entitlements: SessionEntitlements | null;
  /** Módulos habilitados pelo plano (capabilities do backend). */
  capabilities: readonly string[];
  /** Structural organization ownership, separate from assignable roles. */
  isOwner: boolean;
  surfaceAccess: readonly string[];
  productCapabilities: readonly string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  isPlatformAdmin: boolean;
  subscriptionActive: boolean;
  /** Fim do período vigente, em ISO — para dizer **quando** venceu. */
  subscriptionEndsAt: string | null;
  requiresPasswordChange: boolean;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  /** Um módulo está habilitado quando o plano concede a capability. */
  hasCapability: (capability: string) => boolean;
  hasProductCapability: (capability: string) => boolean;
  hasFeature: (feature: string) => boolean;
  canUseProductFeature: (capability: string, feature?: string) => boolean;
  /** Rebusca a sessão (após trocar unidade, aceitar convite etc.). */
  refresh: () => Promise<void>;
  /** Limpa o estado local — o logout de fato ocorre em `/api/auth/logout`. */
  clear: () => void;
}

const EMPTY_SCOPE: SessionScope = {
  organizationId: null,
  businessUnitId: null,
  businessUnitIds: [],
};

const SessionContext = createContext<SessionContextValue | null>(null);

export interface SessionProviderProps {
  children: ReactNode;
  /** Estado inicial vindo do servidor, quando disponível. */
  initialSession?: SessionState;
}

export function SessionProvider({
  children,
  initialSession,
}: SessionProviderProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.session(),
    queryFn: () => authClient.get<SessionState>("/session"),
    initialData: initialSession,
    staleTime: 60_000,
    retry: false,
  });

  const session = query.data ?? ANONYMOUS_SESSION;
  const authenticated = session.authenticated
    ? (session as AuthenticatedSession)
    : null;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session() });
  }, [queryClient]);

  const clear = useCallback(() => {
    queryClient.setQueryData(queryKeys.session(), ANONYMOUS_SESSION);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<SessionContextValue>(() => {
    const permissions = authenticated?.permissions ?? [];
    const roles = authenticated?.roles ?? [];
    const capabilities = authenticated?.entitlements?.capabilities ?? [];
    const wildcard = permissions.includes(WILDCARD_PERMISSION);
    /**
     * `*` no plano concede todos os módulos — como no backend.
     *
     * `SubscriptionPlanService.assertCapabilitiesOn` libera com
     * `granted.has('*')`, e `hasPermission` aqui já honrava o curinga. Só
     * `hasCapability` comparava por igualdade exata: uma organização em plano
     * `['*']` passava por toda rota do servidor e via **todo módulo** da
     * interface como "indisponível no plano".
     *
     * Encontrado no gate de navegador: com o acesso de teste, `/operacoes` e
     * as demais telas de módulo renderizavam a tela de plano insuficiente.
     */
    const capabilityWildcard = capabilities.includes(WILDCARD_PERMISSION);
    const productCapabilities =
      authenticated?.productAccess?.capabilities ?? [];
    const featureAvailability =
      authenticated?.productAccess?.featureAvailability ?? {};
    const isOwner = authenticated?.isOwner ?? false;
    return {
      session,
      user: authenticated?.user ?? null,
      scope: authenticated?.scope ?? EMPTY_SCOPE,
      roles,
      permissions,
      organization: authenticated?.organization ?? null,
      businessUnits: authenticated?.businessUnits ?? [],
      organizations: authenticated?.organizations ?? [],
      entitlements: authenticated?.entitlements ?? null,
      capabilities,
      isOwner,
      surfaceAccess: authenticated?.surfaceAccess ?? [],
      productCapabilities,
      isAuthenticated: Boolean(authenticated),
      isLoading: query.isPending,
      isPlatformAdmin: authenticated?.isPlatformAdmin ?? false,
      subscriptionActive: authenticated?.subscriptionActive ?? false,
      subscriptionEndsAt: authenticated?.subscriptionEndsAt ?? null,
      requiresPasswordChange: authenticated?.requiresPasswordChange ?? false,
      hasPermission: (permission: string) =>
        isOwner || wildcard || permissions.includes(permission),
      hasRole: (role: string) =>
        (isOwner && role !== "PLATFORM_ADMIN") || roles.includes(role),
      hasCapability: (capability: string) =>
        capabilityWildcard || capabilities.includes(capability),
      hasProductCapability: (capability: string) =>
        productCapabilities.includes(capability),
      hasFeature: (feature: string) => featureAvailability[feature] === true,
      canUseProductFeature: (capability: string, feature = capability) =>
        productCapabilities.includes(capability) &&
        featureAvailability[feature] === true,
      refresh,
      clear,
    };
  }, [authenticated, clear, query.isPending, refresh, session]);

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession precisa estar dentro de <SessionProvider>.");
  }
  return context;
}

/** Versão tolerante — devolve `null` fora do provider (ex.: páginas públicas). */
export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext);
}
