import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { SECTION_PARAM } from "@/lib/section-navigation";

/**
 * Modelos de documento viraram aba de Relatórios.
 *
 * A rota fica e redireciona: está em favorito e em link colado numa conversa, e
 * apagá-la daria 404 para quem não fez nada de errado.
 *
 * `/artefatos/:id` **não** muda — é a página do modelo, com o registro na tela,
 * e ela continua exigindo apenas `artifact_templates.read`. Só a porta de
 * entrada se mudou de lugar.
 */
export default function ArtifactTemplatesPage(): never {
  redirect(`${ROUTES.managementReports}?${SECTION_PARAM}=modelos`);
}
