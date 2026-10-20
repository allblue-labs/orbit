"use client";

import Image from "next/image";

/**
 * A assinatura da AllBlue Labs, a empresa que faz o Orbit.
 *
 * O arquivo é só o símbolo — o nome vem ao lado, em texto, porque escrever o
 * nome em texto o mantém legível em qualquer tamanho, selecionável, e
 * traduzível pelo leitor de tela sem depender de `alt`.
 *
 * Duas tintas pelo mesmo motivo da marca do Orbit: o símbolo é azul médio e
 * perde contraste contra a superfície escura do produto. A troca é por CSS,
 * nunca por estado de React.
 */
export function AllblueSignature() {
  return (
    <a
      href="https://allblue-labs.com"
      target="_blank"
      rel="noreferrer noopener"
      className="group inline-flex items-center gap-2 rounded-lg text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="inline-flex size-6 shrink-0 items-center justify-center">
        <Image
          src="/allblue_mark.png"
          alt=""
          aria-hidden
          width={256}
          height={256}
          className="h-full w-full object-contain dark:hidden"
        />
        <Image
          src="/allblue_mark_reverse.png"
          alt=""
          aria-hidden
          width={256}
          height={256}
          className="hidden h-full w-full object-contain dark:block"
        />
      </span>
      <span>
        Feito pela{" "}
        <span className="font-medium text-foreground">AllBlue Labs</span>
      </span>
    </a>
  );
}
