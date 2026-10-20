/**
 * O catálogo comercial, para quem ainda não entrou.
 *
 * ## Uma leitura, no servidor
 *
 * `GET /plans/catalog` é público e devolve os quatro planos com todos os
 * preços e todos os limites. A página busca **uma vez**, no servidor: uma
 * chamada por plano transformaria a página de preços numa cascata, e quem
 * abre uma página de preços vindo de um anúncio não espera.
 *
 * ## Nada é decidido aqui
 *
 * Preço, limite e capacidade chegam prontos. Esta camada não multiplica, não
 * aplica desconto, não infere ilimitado a partir de número mágico e não decide
 * elegibilidade de avaliação — a elegibilidade individual é do backend
 * autenticado, e a superfície pública só comunica a regra geral.
 *
 * ## Sem sessão, de propósito
 *
 * Este módulo não importa nenhum hook de assinatura. É a fronteira que impede
 * a página pública de, por descuido, passar a exigir login para mostrar preço.
 */
import { backendJson } from "@/server/backend-client";
import type { PlanCatalog, PlanCatalogEntry } from "@/types/billing";

/** A capacidade que separa os planos com inteligência. */
export const INTELLIGENCE_CAPABILITY = "ORBIT_INTELLIGENCE";

/**
 * O plano que oferece avaliação gratuita.
 *
 * Espelha `PLANOS_COM_AVALIACAO` do backend. A superfície pública anuncia a
 * regra geral; **quem** tem direito é decidido lá, na contratação, e esta tela
 * nunca avalia elegibilidade individual.
 */
export const TRIAL_PLAN_CODE = "ESSENTIAL";
export const TRIAL_DAYS = 30;

/**
 * Ordem comercial: do menor para o maior.
 *
 * Vem do preço mensal publicado, não de uma lista fixa de códigos — um plano
 * novo no catálogo aparece no lugar certo sem que ninguém edite este arquivo.
 */
export function ordenarPlanos(
  plans: readonly PlanCatalogEntry[],
): PlanCatalogEntry[] {
  return [...plans].sort(
    (a, b) =>
      (a.prices.MONTHLY?.amountMinor ?? 0) - (b.prices.MONTHLY?.amountMinor ?? 0),
  );
}

export function temInteligencia(plano: PlanCatalogEntry): boolean {
  return plano.capabilities.includes(INTELLIGENCE_CAPABILITY);
}

export function ofereceAvaliacao(plano: PlanCatalogEntry): boolean {
  return plano.code === TRIAL_PLAN_CODE;
}

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
