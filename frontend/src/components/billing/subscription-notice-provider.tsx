"use client";

/**
 * Se o aviso de assinatura vencida já foi dispensado — e quem dispensa.
 *
 * ## Mora no layout raiz, e não no shell
 *
 * É a mesma lição da preferência de menu: `AppShell` é montado **por página** e
 * remonta a cada navegação. Com o estado dentro dele, dispensar o aviso valia
 * até o primeiro clique no menu — o componente nascia de novo, lia o valor que
 * o servidor mandou no **primeiro** carregamento (ainda `false`) e o modal
 * reabria. Recarregar a página funcionava, navegar não, que é o contrário do
 * que se esperaria.
 *
 * O provider fica acima do shell, onde não remonta, e o estado atravessa a
 * navegação.
 *
 * ## Duas memórias, porque são duas perguntas
 *
 * O estado responde "já dispensei nesta visita" e sobrevive à navegação. O
 * cookie responde "já dispensei hoje" e sobrevive ao recarregamento — lido no
 * servidor, para o primeiro quadro já sair certo em vez de o modal aparecer e
 * sumir na frente de quem acabou de fechá-lo.
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
  AVISO_COOKIE,
  AVISO_COOKIE_MAX_AGE,
} from "./subscription-notice-cookie";

interface AvisoDeAssinatura {
  dispensado: boolean;
  dispensar: () => void;
}

const Contexto = createContext<AvisoDeAssinatura>({
  dispensado: false,
  dispensar: () => {},
});

export function SubscriptionNoticeProvider({
  dispensado: inicial,
  children,
}: {
  /** Lido do cookie no layout raiz, para o primeiro quadro sair certo. */
  dispensado: boolean;
  children: ReactNode;
}) {
  const [dispensado, setDispensado] = useState(inicial);

  const dispensar = useCallback(() => {
    setDispensado(true);
    /*
      `document.cookie` pode lançar com armazenamento bloqueado. Se não dá para
      lembrar até amanhã, o estado acima ainda cobre esta visita — melhor que
      quebrar a tela.
    */
    try {
      document.cookie = `${AVISO_COOKIE}=1; path=/; max-age=${AVISO_COOKIE_MAX_AGE}; samesite=lax`;
    } catch {
      /* Silêncio de propósito: o aviso volta no próximo carregamento. */
    }
  }, []);

  const valor = useMemo(
    () => ({ dispensado, dispensar }),
    [dispensado, dispensar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** Fora do provider, nada foi dispensado: na dúvida, avisa. */
export function useAvisoDeAssinatura(): AvisoDeAssinatura {
  return useContext(Contexto);
}
