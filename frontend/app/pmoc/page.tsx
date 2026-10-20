import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { SECTION_PARAM } from "@/lib/section-navigation";
import { OPERATIONS_SECTIONS } from "@/components/operations/sections";

/**
 * PMOC virou aba de Operações.
 *
 * A rota fica e redireciona: ela está em favorito, em link colado numa conversa
 * e no histórico de quem usa o sistema há meses. Apagá-la daria 404 para quem
 * não fez nada de errado.
 *
 * `redirect` do servidor, e não uma tela com "fomos para lá": a pessoa pediu o
 * PMOC e o PMOC é isto — o intermediário só cobraria um clique.
 *
 * As rotas de dentro (`/pmoc/:planId`, `/pmoc/unidades`) **não** mudam: são
 * páginas próprias, com o registro na tela, e nada nelas virou aba.
 */
export default function PmocPage(): never {
  redirect(`${ROUTES.operations}?${SECTION_PARAM}=${OPERATIONS_SECTIONS.pmoc}`);
}
