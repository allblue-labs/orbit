import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";

/**
 * O cadastro de unidades mudou de lugar.
 *
 * Ele nasceu como rota solta dentro de PMOC e passou a viver na Central de
 * Catálogos, ao lado dos roteiros de atendimento — é a mesma natureza de
 * cadastro, feito uma vez e reaproveitado pela operação.
 *
 * O redirecionamento fica porque o endereço antigo já circulou: está em link
 * dentro do assistente de PMOC e possivelmente no histórico de quem usa.
 */
export default function LegacyPmocUnitsPage() {
  redirect(`${ROUTES.catalogs}?secao=pmoc`);
}
