import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { SECTION_PARAM } from "@/lib/section-navigation";
import { FINANCIAL_SECTIONS } from "@/components/financial/sections";

/**
 * Orçamentos virou aba do Financeiro.
 *
 * A rota fica e redireciona: ela está em favorito, em link colado numa conversa e
 * no histórico de quem usa o sistema há meses. Apagá-la daria 404 para quem não
 * fez nada de errado.
 *
 * `redirect` do servidor, e não uma tela com "fomos para lá": a pessoa pediu os
 * orçamentos e os orçamentos são isto — o intermediário só cobraria um clique.
 *
 * As rotas de dentro (`/orcamentos/:id`) **não** mudam: são páginas próprias, com
 * o registro na tela, e nada nelas virou aba.
 */
export default function QuotesPage(): never {
  redirect(`${ROUTES.financial}?${SECTION_PARAM}=${FINANCIAL_SECTIONS.quotes}`);
}
