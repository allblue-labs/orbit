"use client";

/**
 * Apresentação compartilhada do catálogo.
 *
 * Tipo e disponibilidade resolvem pelo **Entity Registry** (`EntityBadge`), o
 * mesmo caminho que operações e equipamentos usam. O que sobra aqui é o que é
 * só do catálogo: dinheiro e unidade de medida.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { FORMATTERS } from "@/metrics";
import type { CatalogItem } from "@/types/catalog";

/**
 * Formatação de dinheiro.
 *
 * `salePrice` e `costPrice` chegam como **string** — são `Decimal(14,2)` no
 * banco e o Prisma os serializa assim, o que é o correto: `number` perde
 * precisão em dinheiro.
 *
 * A conversão para `Number` acontece **só para formatar**, no último momento
 * possível, e o resultado nunca volta a ser usado em conta. Nenhum total,
 * margem ou imposto é calculado nesta tela — quem soma é o servidor.
 *
 * O formatador é o **do Metric Registry**, como no Financeiro e nas Propostas.
 * Este arquivo mantinha um `Intl.NumberFormat` próprio — exatamente o segundo
 * mapa de formatação que aqueles dois documentam estar evitando.
 */
export function formatPrice(value: string | null): string {
  if (value === null) return "—";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? FORMATTERS.currency(parsed) : value;
}

/** Preço de venda, com a unidade que o item declara. */
export function PriceLabel({
  item,
  className,
}: {
  item: CatalogItem;
  className?: string;
}) {
  if (item.salePrice === null) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        sem preço
      </span>
    );
  }

  return (
    <span className={cn("text-sm tabular-nums", className)}>
      {formatPrice(item.salePrice)}
      <span className="text-xs text-muted-foreground"> / {item.unit}</span>
    </span>
  );
}

/**
 * Custo — visível apenas onde faz sentido.
 *
 * O backend publica `costPrice` para quem tem `catalog.read`; não há
 * permissão separada. A tela o mostra no detalhe, não na listagem, porque
 * custo ao lado de preço numa tabela é o tipo de dado que vaza numa
 * apresentação de tela compartilhada.
 */
export function CostLabel({ item }: { item: CatalogItem }) {
  return (
    <span className="text-sm tabular-nums">{formatPrice(item.costPrice)}</span>
  );
}

/** SKU em monoespaçada, ou a ausência declarada. */
export function SkuLabel({ sku }: { sku: string | null }) {
  if (!sku) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className="font-mono text-xs">{sku}</span>;
}

/** Linha rotulada de um painel de detalhe. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
