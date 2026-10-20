"use client";

/**
 * A aba aberta, lida e escrita no endereço.
 *
 * Une três coisas que antes não conversavam: o `?secao=` que o usuário digita
 * ou guarda nos favoritos, a aba que o Radix desenha, e o histórico do
 * navegador. Trocar de aba vira uma navegação — e voltar, desfazê-la.
 *
 * Cada seção é um lugar endereçável, então trocar de aba empilha no histórico:
 * voltar desfaz a troca em vez de sair da página. É o que se espera de um
 * endereço que se pode copiar — e o preço é um passo de histórico por aba
 * visitada, que é justamente o que permite voltar.
 */
import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  SECTION_PARAM,
  resolveSection,
  sectionHref,
  type SectionSlug,
} from "@/lib/section-navigation";

export interface SectionNavigation {
  /** A seção que a URL pede, ou a primeira quando não pede nenhuma. */
  readonly current: SectionSlug;
  /** Abre outra seção, preservando o resto da consulta. */
  readonly go: (section: SectionSlug) => void;
  /** O endereço de uma seção, para links. */
  readonly hrefFor: (section: SectionSlug) => string;
}

export function useSectionFromUrl(
  available: readonly SectionSlug[],
): SectionNavigation {
  const pathname = usePathname();
  const params = useSearchParams();

  const current = resolveSection(params.get(SECTION_PARAM), available);

  const hrefFor = useCallback(
    (section: SectionSlug) => sectionHref(pathname, section, params),
    [pathname, params],
  );

  const go = useCallback(
    (section: SectionSlug) => {
      if (section === current) return;
      /**
       * `history.pushState`, e não `router.push`.
       *
       * Estas páginas são estáticas do lado do servidor — nenhuma delas lê
       * `searchParams` no Server Component. Nessa condição o roteador trata um
       * empurrão que só muda a consulta como destino já ocupado e não faz
       * nada: medido, o endereço não mudava e a aba não trocava a partir da
       * segunda vez.
       *
       * O Next integra `pushState`/`replaceState` nativos ao próprio roteador,
       * então `useSearchParams` acompanha, voltar e avançar funcionam, e a
       * troca de aba não custa uma ida ao servidor para buscar a mesma árvore.
       */
      window.history.pushState(null, "", hrefFor(section));
    },
    [current, hrefFor],
  );

  return { current, go, hrefFor };
}
