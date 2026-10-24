/**
 * O estado de assinatura, do ponto de vista de quem desenha a tela.
 *
 * Um módulo só para que o aviso, o selo da topbar e qualquer tela futura
 * concordem — inclusive sobre o endereço para onde mandam a pessoa.
 */

/** A aba onde se escolhe e se troca o plano. */
export const ROUTE_ASSINATURA = "/configuracoes?secao=assinatura";

import { DEFAULT_TIMEZONE } from "@/lib/env";

/**
 * A data do vencimento, por extenso.
 *
 * `null` quando não há período — e aí o aviso simplesmente não menciona data,
 * em vez de imprimir "Invalid Date" na cara de quem já está com problema.
 */
export function dataDeVencimento(
  iso: string | null,
  timeZone = DEFAULT_TIMEZONE,
): string | null {
  if (!iso) return null;
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? null
    : new Intl.DateTimeFormat("pt-BR", {
        timeZone,
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(data);
}
