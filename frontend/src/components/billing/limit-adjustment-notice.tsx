"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { useSession } from "@/providers/session-provider";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { OrganizationEntitlementsView } from "@/types/billing";
import { ROUTE_ASSINATURA } from "./subscription-access";
import { rotuloDoRecurso } from "./billing-format";

export function LimitAdjustmentNotice() {
  const { formatDateTime } = useDateFormatters();
  const { isAuthenticated, organization, permissions, isOwner } = useSession();
  const canRead =
    isAuthenticated &&
    !!organization &&
    (isOwner ||
      permissions.includes("*") ||
      permissions.includes("usage.read"));
  const quotas = useApiQuery(
    queryKeys.detail("entitlements", organization?.id ?? "none"),
    ({ signal }) =>
      apiClient.get<OrganizationEntitlementsView>(
        "/organizations/current/entitlements",
        { signal },
      ),
    { ...CACHE.fresh, enabled: canRead, refetchInterval: 30_000 },
  );
  const adjustment = quotas.data?.limitAdjustment;
  if (!adjustment) return null;
  const deadline = formatDateTime(adjustment.deadline);
  return (
    <aside
      role="alert"
      className="m-4 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"
    >
      <AlertTriangle
        className="mt-0.5 size-5 shrink-0 text-amber-600"
        aria-hidden
      />
      <div className="space-y-2">
        <p className="font-semibold">
          {adjustment.blocked
            ? "Alguns recursos estão bloqueados por exceder os limites do plano"
            : "Seu novo plano começou: ajuste os recursos excedentes em até 48 horas"}
        </p>
        <p>
          {adjustment.blocked
            ? "Regularize os excedentes para liberar os recursos afetados."
            : `Você tem até ${deadline} para desativar, arquivar ou excluir os excedentes por sua escolha. Depois desse prazo, os recursos afetados serão bloqueados.`}{" "}
          O Orbit não exclui seus dados automaticamente.
        </p>
        <ul className="list-inside list-disc">
          {adjustment.resources.map((r) => (
            <li key={r.resource}>
              {rotuloDoRecurso(r.resource)}: {r.current} em uso /{" "}
              {r.limit.value ?? "ilimitado"} permitidos
            </li>
          ))}
        </ul>
        <Link className="font-medium underline" href={ROUTE_ASSINATURA}>
          Ver plano e limites
        </Link>
      </div>
    </aside>
  );
}
