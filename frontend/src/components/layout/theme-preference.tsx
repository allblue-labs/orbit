"use client";

/**
 * A preferência de tema, compartilhada pela aplicação.
 *
 * ## Onde ela vive
 *
 * Num cookie, e não em `localStorage`: o layout raiz é Server Component e lê o
 * cookie para já mandar a classe certa no HTML. Com `localStorage` o servidor
 * não teria como saber, e toda navegação começaria clara antes de escurecer.
 *
 * ## `system` acompanha o sistema enquanto a aba estiver aberta
 *
 * Quem escolhe "Sistema" espera que trocar o tema do computador ao anoitecer
 * troque o do Orbit junto, sem recarregar. Por isso o provider ouve
 * `prefers-color-scheme` — e para de ouvir quando a escolha é explícita.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  type ResolvedTheme,
  type Theme,
} from "./theme-cookie";

interface ThemePreference {
  /** O que a pessoa escolheu: `system`, `light` ou `dark`. */
  theme: Theme;
  /** O que está pintado agora — `system` já resolvido. */
  resolved: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemePreference | null>(null);

/**
 * A preferência do sistema, como fonte externa.
 *
 * `useSyncExternalStore` e não estado com efeito: `matchMedia` é um store de
 * fora do React, e sincronizá-lo com `setState` dentro de um efeito produz um
 * render em cascata a cada montagem — além de pintar o quadro errado antes de
 * corrigir. Aqui o React lê o valor na hora de renderizar e reassina sozinho.
 */
const CONSULTA = "(prefers-color-scheme: dark)";

function assinarSistema(aoMudar: () => void): () => void {
  let media: MediaQueryList;
  try {
    media = window.matchMedia(CONSULTA);
  } catch {
    /* Janela privada com mídia bloqueada: nada a assinar. */
    return () => undefined;
  }
  media.addEventListener("change", aoMudar);
  return () => media.removeEventListener("change", aoMudar);
}

function lerSistema(): ResolvedTheme {
  try {
    return window.matchMedia(CONSULTA).matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * No servidor não há sistema para consultar.
 *
 * `light` é o palpite conservador, e ele nunca chega a ser pintado: o script de
 * bootstrap resolve o tema antes da primeira pintura, e a hidratação encontra a
 * classe já correta no `<html>`.
 */
const lerSistemaNoServidor = (): ResolvedTheme => "light";

export function ThemePreferenceProvider({
  children,
  initialTheme,
}: {
  children: ReactNode;
  /** Resolvido no layout raiz, a partir do cookie. */
  initialTheme: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const doSistema = useSyncExternalStore(
    assinarSistema,
    lerSistema,
    lerSistemaNoServidor,
  );

  /** Derivado, não guardado: `system` é uma instrução, não um terceiro visual. */
  const resolved: ResolvedTheme = theme === "system" ? doSistema : theme;

  /**
   * O único efeito: manter o `<html>` em dia.
   *
   * É atualização de sistema externo — o DOM —, que é para o que efeito serve.
   * Nada de `setState` aqui.
   */
  useEffect(() => {
    const raiz = document.documentElement;
    raiz.classList.toggle("dark", resolved === "dark");
    raiz.style.colorScheme = resolved;
  }, [resolved]);

  const setTheme = useCallback((escolhido: Theme) => {
    setThemeState(escolhido);
    try {
      document.cookie = `${THEME_COOKIE}=${escolhido}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`;
    } catch {
      /* Sem cookie a escolha vale só nesta aba — melhor que não valer. */
    }
  }, []);

  const valor = useMemo(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  );

  return (
    <ThemeContext.Provider value={valor}>{children}</ThemeContext.Provider>
  );
}

export function useThemePreference(): ThemePreference {
  const contexto = useContext(ThemeContext);
  if (!contexto) {
    throw new Error(
      "useThemePreference precisa de ThemePreferenceProvider acima",
    );
  }
  return contexto;
}
