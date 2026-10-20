/**
 * O cookie da preferência de menu — nome e leitura.
 *
 * Módulo **sem** `"use client"` de propósito: o layout raiz é Server
 * Component e precisa chamar `parseSidebarCookie` para renderizar a largura
 * certa no primeiro quadro. Uma função exportada de um arquivo cliente não
 * pode ser chamada do servidor — o Next recusa com "Attempted to call ...
 * from the server but ... is on the client", e a página inteira vira 500.
 *
 * Aqui fica só o que é puro; o provider e o hook ficam no arquivo cliente.
 */
export const SIDEBAR_COOKIE = "orbit_sidebar";

/** Um ano: é preferência, não sessão. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * O padrão quando ninguém escolheu ainda é **recolhido**.
 *
 * Qualquer valor fora de `"0"` e `"1"` — cookie adulterado, ou de uma versão
 * anterior — cai no padrão em vez de virar um terceiro estado.
 */
export function parseSidebarCookie(value: string | undefined): boolean {
  return value !== "0";
}
