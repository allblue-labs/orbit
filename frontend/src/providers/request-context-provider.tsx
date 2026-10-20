"use client";

/**
 * Mantém o contexto multi-tenant sincronizado com a sessão.
 *
 * Toda chamada feita por `@/api` passa a enviar automaticamente
 * `organizationId`, `businessUnitId`, `locale` e `timezone` — nenhum módulo
 * precisa repetir isso.
 *
 * A troca de unidade (`setBusinessUnit`) atualiza o contexto e descarta o
 * cache do TanStack Query, já que todo dado carregado pertence ao escopo
 * anterior.
 */
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ORBIT_QUERY_SCOPE } from "@/api/query-keys";
import { getAmbientContext, setAmbientContext } from "@/api/request-context";
import type { OrbitRequestContext } from "@/types/api";
import { useOptionalSession } from "./session-provider";

export type AmbientRequestContext = Omit<OrbitRequestContext, "requestId">;

export interface RequestContextValue extends AmbientRequestContext {
  /** Unidades acessíveis pela sessão atual. */
  availableBusinessUnitIds: readonly string[];
  setBusinessUnit: (businessUnitId: string | null) => void;
  setOrganization: (organizationId: string | null) => void;
  setLocale: (locale: string) => void;
}

const RequestContext = createContext<RequestContextValue | null>(null);

export function RequestContextProvider({ children }: { children: ReactNode }) {
  const session = useOptionalSession();
  const queryClient = useQueryClient();

  /** Locale e timezone do dispositivo, detectados uma única vez. */
  const [detected] = useState(getAmbientContext);
  const [locale, setLocale] = useState(detected.locale);
  const [businessUnitOverride, setBusinessUnitOverride] = useState<
    string | null
  >(null);
  const [organizationOverride, setOrganizationOverride] = useState<
    string | null
  >(null);

  const sessionOrganizationId = session?.scope.organizationId ?? null;
  const sessionBusinessUnitId = session?.scope.businessUnitId ?? null;

  const context = useMemo<AmbientRequestContext>(
    () => ({
      /** A escolha do usuário tem precedência sobre o escopo da sessão. */
      organizationId: organizationOverride ?? sessionOrganizationId,
      businessUnitId: businessUnitOverride ?? sessionBusinessUnitId,
      locale,
      timezone: detected.timezone,
    }),
    [
      businessUnitOverride,
      detected.timezone,
      locale,
      organizationOverride,
      sessionBusinessUnitId,
      sessionOrganizationId,
    ],
  );

  /** Espelha o contexto no store lido pelo cliente HTTP. */
  useEffect(() => {
    setAmbientContext(context);
  }, [context]);

  /**
   * Descarta os dados do escopo anterior, preservando a sessão.
   *
   * Cancelar antes de remover não é detalhe: uma requisição em voo da unidade
   * anterior continuaria correndo e, ao responder, repovoaria o cache **já no
   * escopo novo** — a filial que se acabou de deixar reaparecendo na tela da
   * filial escolhida. `cancelQueries` aborta o que está em trânsito; o
   * `signal` que os serviços já propagam faz o resto.
   */
  const discardScopedQueries = useCallback(() => {
    const scoped = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === ORBIT_QUERY_SCOPE &&
        query.queryKey[1] !== "session",
    };
    void queryClient.cancelQueries(scoped);
    queryClient.removeQueries(scoped);
  }, [queryClient]);

  const setBusinessUnit = useCallback(
    (businessUnitId: string | null) => {
      setBusinessUnitOverride(businessUnitId);
      discardScopedQueries();
    },
    [discardScopedQueries],
  );

  const setOrganization = useCallback(
    (organizationId: string | null) => {
      setOrganizationOverride(organizationId);
      /** Trocar de organização invalida também a unidade selecionada. */
      setBusinessUnitOverride(null);
      discardScopedQueries();
    },
    [discardScopedQueries],
  );

  const value = useMemo<RequestContextValue>(
    () => ({
      ...context,
      availableBusinessUnitIds: session?.scope.businessUnitIds ?? [],
      setBusinessUnit,
      setOrganization,
      setLocale,
    }),
    [context, session?.scope.businessUnitIds, setBusinessUnit, setOrganization],
  );

  return (
    <RequestContext.Provider value={value}>{children}</RequestContext.Provider>
  );
}

export function useRequestContext(): RequestContextValue {
  const context = useContext(RequestContext);
  if (!context) {
    throw new Error(
      "useRequestContext precisa estar dentro de <RequestContextProvider>.",
    );
  }
  return context;
}
