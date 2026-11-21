"use client";

/**
 * As leituras e os comandos da área do cliente na web.
 *
 * As chaves começam com `portal`: nada aqui se mistura com o cache da equipe,
 * e sair limpa só o que é do cliente.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import { portalRequest, PortalSessionExpired } from "./portal-client";
import type {
  PortalAsset,
  PortalDocument,
  PortalMe,
  PortalOperation,
  PortalPage,
  PortalProfile,
  PortalSummary,
  ServiceRequest,
} from "./portal-types";
import {
  newIdempotencyKey,
  requestPayload,
  type RequestDraft,
} from "./service-request-model";

const K = {
  all: ["portal"] as const,
  session: ["portal", "session"] as const,
  summary: ["portal", "summary"] as const,
  operations: (assetId?: string) =>
    ["portal", "operations", assetId ?? "all"] as const,
  operation: (id: string) => ["portal", "operation", id] as const,
  assets: (search: string) => ["portal", "assets", search] as const,
  asset: (id: string) => ["portal", "asset", id] as const,
  documents: (filter: DocumentFilter) =>
    ["portal", "documents", filter] as const,
  profile: ["portal", "profile"] as const,
  requests: ["portal", "requests"] as const,
  request: (id: string) => ["portal", "request", id] as const,
};

export interface DocumentFilter {
  category?: string;
  operationId?: string;
  assetId?: string;
}

/** Erro de sessão não se repete: manda para o login. */
const retry = (count: number, error: unknown) =>
  !(error instanceof PortalSessionExpired) && count < 2;

export function usePortalSession() {
  return useQuery({
    queryKey: K.session,
    queryFn: async () =>
      (await portalRequest<{ me: PortalMe }>("/session")).me,
    retry: false,
    staleTime: 60_000,
  });
}

export function usePortalLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      portalRequest<{ me: PortalMe }>("/auth/login", {
        method: "POST",
        body: input,
      }),
    onSuccess: (result) => {
      client.removeQueries({ queryKey: K.all });
      client.setQueryData(K.session, result.me);
    },
  });
}

export function usePortalLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => portalRequest("/auth/logout", { method: "POST" }),
    onSettled: () => client.removeQueries({ queryKey: K.all }),
  });
}

export function useChangePortalPassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      portalRequest("/auth/password", { method: "PATCH", body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: K.session }),
  });
}

export function usePortalSummary() {
  return useQuery({
    queryKey: K.summary,
    queryFn: () => portalRequest<PortalSummary>("/me/summary"),
    retry,
  });
}

export function usePortalOperations(assetId?: string) {
  return useQuery({
    queryKey: K.operations(assetId),
    queryFn: () =>
      portalRequest<PortalPage<PortalOperation>>("/me/operations", {
        query: {
          limit: 50,
          sortBy: "date",
          order: "desc",
          assetId,
        },
      }),
    retry,
  });
}

export function usePortalOperation(id: string | null) {
  return useQuery({
    queryKey: K.operation(id ?? ""),
    queryFn: () => portalRequest<PortalOperation>(`/me/operations/${id}`),
    enabled: Boolean(id),
    retry,
  });
}

export function usePortalAssets(search: string) {
  return useQuery({
    queryKey: K.assets(search),
    queryFn: () =>
      portalRequest<PortalPage<PortalAsset>>("/me/assets", {
        query: { limit: 50, sortBy: "name", order: "asc", search },
      }),
    retry,
  });
}

export function usePortalAsset(id: string | null) {
  return useQuery({
    queryKey: K.asset(id ?? ""),
    queryFn: () => portalRequest<PortalAsset>(`/me/assets/${id}`),
    enabled: Boolean(id),
    retry,
  });
}

export function usePortalDocuments(filter: DocumentFilter, enabled = true) {
  return useQuery({
    queryKey: K.documents(filter),
    queryFn: () =>
      portalRequest<PortalPage<PortalDocument>>("/me/documents", {
        query: {
          limit: 50,
          sortBy: "issuedAt",
          order: "desc",
          ...filter,
        },
      }),
    enabled,
    retry,
  });
}

/** A URL assinada do documento, pedida no clique — ela vence em minutos. */
export function portalDocumentAccess(id: string) {
  return portalRequest<{ url: string }>(`/me/documents/${id}/access`);
}

export function usePortalProfile() {
  return useQuery({
    queryKey: K.profile,
    queryFn: () => portalRequest<PortalProfile>("/me/profile"),
    retry,
  });
}

export function usePortalProfileCommand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      command:
        | { kind: "avatar"; file: Blob }
        | { kind: "signature"; file: Blob }
        | { kind: "remove-avatar" }
        | { kind: "remove-signature" },
    ) => {
      if (command.kind === "remove-avatar")
        return portalRequest<PortalProfile>("/me/avatar", { method: "DELETE" });
      if (command.kind === "remove-signature")
        return portalRequest<PortalProfile>("/me/signature", {
          method: "DELETE",
        });
      const form = new FormData();
      form.set(
        "file",
        command.file,
        command.kind === "signature" ? "assinatura.png" : "foto",
      );
      return portalRequest<PortalProfile>(
        command.kind === "avatar" ? "/me/avatar" : "/me/signature",
        { method: "PUT", body: form },
      );
    },
    onSuccess: (profile) => client.setQueryData(K.profile, profile),
  });
}

export function usePortalRequests() {
  return useQuery({
    queryKey: K.requests,
    queryFn: () =>
      portalRequest<PortalPage<ServiceRequest>>("/me/service-requests", {
        query: { limit: 50 },
      }),
    retry,
  });
}

export function usePortalRequest(id: string | null) {
  return useQuery({
    queryKey: K.request(id ?? ""),
    queryFn: () => portalRequest<ServiceRequest>(`/me/service-requests/${id}`),
    enabled: Boolean(id),
    retry,
  });
}

function refreshRequests(client: QueryClient, request: ServiceRequest) {
  client.setQueryData(K.request(request.id), request);
  void client.invalidateQueries({ queryKey: K.requests });
}

/**
 * Abrir chamado. A chave é criada uma vez por assistente e reusada nas novas
 * tentativas: rede ruim não vira dois chamados.
 */
export function useOpenRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { draft: RequestDraft; key: string }) =>
      portalRequest<ServiceRequest>("/me/service-requests", {
        method: "POST",
        body: requestPayload(input.draft),
        headers: { "idempotency-key": input.key },
      }),
    onSuccess: (request) => refreshRequests(client, request),
  });
}

export function useUpdateRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number; draft: RequestDraft }) =>
      portalRequest<ServiceRequest>(`/me/service-requests/${input.id}`, {
        method: "PATCH",
        body: {
          ...requestPayload(input.draft),
          expectedVersion: input.version,
        },
      }),
    onSuccess: (request) => refreshRequests(client, request),
  });
}

export function useReplyRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number; message: string }) =>
      portalRequest<ServiceRequest>(
        `/me/service-requests/${input.id}/messages`,
        {
          method: "POST",
          body: { message: input.message, expectedVersion: input.version },
        },
      ),
    onSuccess: (request) => refreshRequests(client, request),
  });
}

export function useCancelRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; version: number }) =>
      portalRequest<ServiceRequest>(`/me/service-requests/${input.id}/cancel`, {
        method: "POST",
        body: { expectedVersion: input.version },
      }),
    onSuccess: (request) => refreshRequests(client, request),
  });
}

export { newIdempotencyKey };
