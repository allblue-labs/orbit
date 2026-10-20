/**
 * O cookie do tema — nome, valores e leitura.
 *
 * Módulo **sem** `"use client"` de propósito, pela mesma lição do menu: o
 * layout raiz é Server Component e precisa ler o tema para pintar o primeiro
 * quadro já certo. Uma função exportada de um arquivo cliente não pode ser
 * chamada do servidor — o Next recusa e a página inteira vira 500.
 */

export const THEME_COOKIE = "orbit_theme";

/** Um ano: é preferência, não sessão. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * As três opções.
 *
 * `system` é o padrão e não é um terceiro visual: é a instrução de seguir o
 * sistema operacional, que resolve para claro ou escuro em tempo de execução.
 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** O tema efetivamente pintado — `system` já resolvido. */
export type ResolvedTheme = "light" | "dark";

/**
 * O padrão quando ninguém escolheu ainda é **seguir o sistema**.
 *
 * Qualquer valor fora dos três — cookie adulterado, ou de uma versão anterior —
 * cai no padrão em vez de virar um quarto estado.
 */
export function parseThemeCookie(value: string | undefined): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "system";
}

/**
 * O script que roda **antes da primeira pintura**.
 *
 * Existe por causa de `system`: o servidor não sabe qual tema o sistema
 * operacional de quem abre está usando, e descobrir isso depois da hidratação
 * significa pintar claro e trocar para escuro na frente da pessoa.
 *
 * É deliberadamente minúsculo e sem dependência: ele roda síncrono no `<head>`,
 * e qualquer coisa que demore aqui atrasa a página inteira. O `try` existe
 * porque `matchMedia` e `document.cookie` podem lançar numa janela privada com
 * armazenamento bloqueado — e um tema errado é melhor que uma tela branca.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);
var t=m?decodeURIComponent(m[1]):'system';
if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
document.documentElement.classList.toggle('dark',t==='dark');
document.documentElement.style.colorScheme=t;
}catch(e){}})();`;
