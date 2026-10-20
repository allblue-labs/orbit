import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { SECTION_PARAM } from "@/lib/section-navigation";
import { REPORTS_SECTIONS } from "@/components/management-reports/sections";

/**
 * Documentos emitidos virou aba de Relatórios.
 *
 * O grupo "Documentos" do menu tinha três itens que descrevem o mesmo ciclo: o
 * documento emitido, o relatório do período e o modelo que os gera. Os modelos já
 * eram aba de Relatórios; agora os emitidos também, e o grupo deixou de existir —
 * o menu estava criando rolagem em tela full HD.
 *
 * A rota fica e redireciona, pela mesma razão de `/pmoc` e `/orcamentos`: está em
 * favorito e em link guardado. As rotas de dentro (`/execucoes/:id`) não mudam.
 */
export default function DocumentsPage(): never {
  redirect(
    `${ROUTES.managementReports}?${SECTION_PARAM}=${REPORTS_SECTIONS.documents}`,
  );
}
