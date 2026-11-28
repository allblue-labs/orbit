"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";
import logo from "../../../public/orbit_logo.png";
import logoReverse from "../../../public/orbit_logo_reverse.png";
import mark from "../../../public/orbit_mark.png";
import markReverse from "../../../public/orbit_mark_reverse.png";

/**
 * Quatro arquivos: duas formas, duas tintas.
 *
 * `orbit_logo` é o logotipo completo — símbolo mais palavra. `orbit_mark` é só
 * o símbolo. Cada um tem a sua **reversa**, que é a mesma arte com a tinta
 * escura clareada para fundo escuro: o corpo do planeta é azul-marinho e, sobre
 * a superfície escura do produto, sumia — restava um anel flutuando. O acento
 * ciano não muda, porque já lê nos dois fundos.
 *
 * ## Por que não há mais chapa
 *
 * A marca vinha dentro de um cartão branco com anel e sombra. Resolvia o
 * contraste do jeito mais barato e cobrava caro: no header claro virava um
 * adesivo colado, e no escuro, uma laje branca. A arte é PNG com alfa de
 * verdade — o que faltava era a tinta clara, não a chapa.
 */
const ARTES = {
  full: { claro: logo, escuro: logoReverse },
  mark: { claro: mark, escuro: markReverse },
} as const;

type OrbitLogoProps = {
  /** Logotipo completo (símbolo + palavra) ou só o símbolo. */
  variant?: "full" | "mark";
  className?: string;
};

/**
 * A marca oficial do Orbit. Não redesenhe nem recolora — as duas tintas que
 * existem são estas, e a troca entre elas é por tema, não por gosto.
 *
 * A troca é por CSS, e não por estado de React: um `useTheme` renderizaria a
 * tinta errada no HTML servido e corrigiria depois da hidratação, o que
 * aparece como um piscar da marca a cada carregamento.
 */
export function OrbitLogo({ variant = "full", className }: OrbitLogoProps) {
  const arte = ARTES[variant];
  const alt = variant === "full" ? "Orbit Operations ERP" : "Orbit";

  /*
    A altura manda; a largura segue a proporção da arte.

    O contêrner do logotipo não fixa largura, então pedir `w-full` na imagem
    fecharia um ciclo — a caixa mede pelo conteúdo, o conteúdo mede pela caixa.
    O símbolo é quadrado e cabe na caixa quadrada, e aí `w-full` é literal.
  */
  const larguraDaArte = variant === "full" ? "w-auto" : "w-full";

  /*
    O nome fica no contêiner, e as duas imagens são decorativas.

    Cada tinta é escondida com `display:none` no tema em que não serve — e isso
    tira o elemento da árvore de acessibilidade junto com o `alt` dele. Com o
    nome em cada imagem, no escuro a marca ficava anônima: a clara sumia com o
    texto, e a escura era `aria-hidden`. No rodapé, onde não há link rotulado
    em volta, não sobrava nada para anunciar.
  */
  return (
    <span
      role="img"
      aria-label={alt}
      className={cn(
        "inline-flex items-center justify-center",
        variant === "full" ? "h-8" : "size-9",
        className,
      )}
    >
      <Image
        src={arte.claro}
        alt=""
        aria-hidden
        unoptimized
        priority
        className={cn("h-full object-contain dark:hidden", larguraDaArte)}
      />
      <Image
        src={arte.escuro}
        alt=""
        aria-hidden
        unoptimized
        priority
        className={cn("hidden h-full object-contain dark:block", larguraDaArte)}
      />
    </span>
  );
}
