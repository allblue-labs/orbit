/**
 * O cookie que silencia o aviso de assinatura vencida.
 *
 * Módulo **sem** `"use client"`, pela mesma razão do tema: o layout que monta
 * o shell é Server Component e precisa saber, antes de pintar, se o aviso já
 * foi dispensado. Descobrir isso depois da hidratação faria o modal aparecer e
 * sumir na frente de quem já o tinha fechado.
 */

export const AVISO_COOKIE = "orbit_aviso_assinatura";

/**
 * Doze horas.
 *
 * Não é preferência, é "já li hoje". Um ano silenciaria para sempre quem
 * fechou o aviso uma vez em setembro, e a sessão do navegador é curta demais:
 * quem recarrega a página no meio da manhã veria de novo.
 */
export const AVISO_COOKIE_MAX_AGE = 60 * 60 * 12;

export function avisoFoiDispensado(value: string | undefined): boolean {
  return value === "1";
}
