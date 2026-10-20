"use client";

/**
 * A preferência de menu recolhido, lembrada entre páginas e recargas.
 *
 * ## Os dois defeitos que isto resolve
 *
 * **O piscar a cada navegação.** `AppShell` — e com ele a `Sidebar` — é
 * montado por página, não por layout. Cada navegação remontava o componente,
 * o `useState(true)` voltava ao padrão e o `motion.aside` reanimava a
 * largura. Este provider mora no layout raiz, que **não** remonta: o estado
 * atravessa a navegação.
 *
 * **A escolha esquecida.** Não havia persistência nenhuma. Agora vai para um
 * cookie — e cookie, não `localStorage`, porque o servidor precisa lê-lo para
 * renderizar a largura correta já no HTML. Com `localStorage` o primeiro
 * quadro sairia sempre errado e o piscar voltaria por outro caminho.
 *
 * O cookie é preferência de interface: não é `HttpOnly` (o cliente escreve
 * nele) e não carrega nada sensível.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  SIDEBAR_COOKIE,
  SIDEBAR_COOKIE_MAX_AGE,
} from "./sidebar-cookie";

export interface SidebarPreference {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarPreferenceContext = createContext<SidebarPreference | null>(null);

export function SidebarPreferenceProvider({
  initialCollapsed,
  children,
}: {
  /** Lido do cookie no servidor, para o primeiro quadro já sair certo. */
  initialCollapsed: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((atual) => {
      const proximo = !atual;
      try {
        document.cookie = `${SIDEBAR_COOKIE}=${proximo ? "1" : "0"}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}; samesite=lax`;
      } catch {
        /// Navegador com cookies bloqueados: a escolha vale para esta
        /// navegação e não é lembrada. Preferência não justifica erro.
      }
      return proximo;
    });
  }, []);

  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);

  return (
    <SidebarPreferenceContext.Provider value={value}>
      {children}
    </SidebarPreferenceContext.Provider>
  );
}

/**
 * Fora do provider — a página de design system monta o shell sozinha — o
 * menu continua funcionando, só não lembra a escolha.
 */
export function useSidebarPreference(): SidebarPreference {
  const context = useContext(SidebarPreferenceContext);
  const [fallback, setFallback] = useState(true);
  const toggleFallback = useCallback(
    () => setFallback((atual) => !atual),
    [],
  );
  return (
    context ?? { collapsed: fallback, toggle: toggleFallback }
  );
}
