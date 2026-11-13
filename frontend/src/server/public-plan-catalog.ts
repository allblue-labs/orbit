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

    /**
     * Cacheável porque é igual para todo mundo.
     *
     * O catálogo é congelado no código do backend e muda quando alguém publica
     * uma versão nova — não a cada minuto, e nunca por visitante. Cinco minutos
     * de reaproveitamento evitam uma ida ao backend por visita à landing, que é
     * a página mais acessada do produto e a que mais depende de abrir rápido.
     */
    revalidateSeconds: 300,
  });
}
