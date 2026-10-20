import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { SECTION_PARAM } from "@/lib/section-navigation";
import { OPERATIONS_SECTIONS } from "@/components/operations/sections";

/**
 * RVT virou aba de Operações.
 *
 * Mesma razão do PMOC: a rota permanece e redireciona, porque link guardado não
 * pode virar 404. `/rvt/:configurationId` e `/rvt/execucoes` seguem intactas.
 */
export default function RvtPage(): never {
  redirect(`${ROUTES.operations}?${SECTION_PARAM}=${OPERATIONS_SECTIONS.rvt}`);
}
