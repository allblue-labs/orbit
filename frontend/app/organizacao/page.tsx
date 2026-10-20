import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";
import { SECTION_PARAM } from "@/lib/section-navigation";

/**
 * A administração da organização mudou de porta, não de lugar.
 *
 * `/organizacao` e `/configuracoes` mostravam o mesmo conteúdo montado de dois
 * jeitos — plano, unidades, capabilities e dados da empresa apareciam nas duas
 * rotas, e "Integrações" tinha uma seção aqui e uma aba lá. Ficou uma porta: a
 * seção **Organização** das Configurações, que já existia e reunia as mesmas
 * peças.
 *
 * A rota sobrevive porque endereços guardados e links antigos apontam para
 * ela, e leva direto à seção certa — não à primeira aba.
 */
export default function OrganizationPage() {
  redirect(`${ROUTES.settings}?${SECTION_PARAM}=organizacao`);
}
