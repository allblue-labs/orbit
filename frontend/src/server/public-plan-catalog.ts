import "server-only";
import { backendJson } from "./backend-client";
import type { PlanCatalog } from "@/types/billing";

/**
 * O catálogo público.
 *
 * Sem contexto de sessão: a rota é `@Public()` no backend, e mandar
 * credencial de servidor numa leitura pública seria dar a ela um privilégio
 * que ela não precisa.
 */
export async function carregarCatalogoPublico(): Promise<PlanCatalog> {
  return backendJson<PlanCatalog>({
    path: "/plans/catalog",

    revalidateSeconds: 60,
  });
}
