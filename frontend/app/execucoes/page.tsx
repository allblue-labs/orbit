import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { SECTION_PARAM } from "@/lib/section-navigation";
import { REPORTS_SECTIONS } from "@/components/management-reports/sections";

/**
 * A listagem global de execuções deixou de existir.
 *
 * ## Por que redirecionar, e não devolver 404
 *
 * O caminho continua sendo alcançável por link salvo, favorito e histórico. Um
 * 404 diria "isto não existe", quando o que existe é outro nome para a mesma
 * coisa: o documento que a pessoa procurava está em **Relatórios › Documentos
 * emitidos**, que reúne o que foi emitido — ordem de serviço, PMOC, visita
 * técnica, recibo, orçamento e relatório gerencial.
 *
 * Aponta para o destino final, e não para `/documentos`, que também só
 * redireciona: dois saltos para chegar ao mesmo lugar deixam uma entrada a mais no
 * histórico do navegador, e voltar passa a precisar de dois cliques.
 *
 * O deep link por execução (`/execucoes/:id`) **continua funcionando**: ele é
 * usado a partir do cliente, da equipe e do ciclo de PMOC, e apaga-lo quebraria
 * navegação contextual legítima. O que saiu foi a porta de entrada global — a
 * que oferecia um conceito de arquitetura como se fosse área de produto.
 */
export default function ArtifactExecutionsPage(): never {
  redirect(
    `${ROUTES.managementReports}?${SECTION_PARAM}=${REPORTS_SECTIONS.documents}`,
  );
}
