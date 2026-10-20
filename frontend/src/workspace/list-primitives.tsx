"use client";

/**
 * Primitivos de listagem — busca, filtros, contagem, paginação e estados.
 *
 * Cada Workspace escreveu os seus. O bloco de paginação existia em sete
 * cópias; o campo de busca com a lupa posicionada, em seis; a cadeia
 * `isPending ? … : error ? … : vazio ? … : conteúdo`, em treze. Eram idênticos
 * o bastante para que uma correção precisasse ser feita sete vezes, e
 * diferentes o bastante para que uma delas ficasse para trás.
 *
 * **Nada aqui é Design System novo.** Todos usam `Button`, `Input`, `Label`,
 * `Select` e os tokens já existentes — o que muda é onde a composição mora.
 */
import type { ReactNode } from "react";
import { ListFilter, Search } from "lucide-react";

import { EmptyState } from "@/components/feedback/states";
import { PanelError, PanelLoading } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { ANY_OPTION, fromAnyOption, toAnyOption } from "./use-list-controller";

/** O `meta` que toda listagem paginada do backend devolve. */
export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/* ------------------------------------------------------------------ */
/* Busca                                                               */
/* ------------------------------------------------------------------ */

export function SearchField({
  id,
  value,
  onChange,
  label = "Buscar",
  placeholder,
  /** O que o backend de fato procura — dito para não prometer demais. */
  hint,
  maxLength,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className="pl-9"
        />
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filtros                                                             */
/* ------------------------------------------------------------------ */

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Opções a partir de um enum do contrato e do mapa de rótulos do módulo.
 *
 * ```ts
 * optionsFrom(Object.values(OperationStatus), OPERATION_STATUS_LABELS)
 * ```
 *
 * Valor sem rótulo aparece cru — um status novo do backend precisa aparecer,
 * não sumir do filtro.
 */
export function optionsFrom(
  values: readonly string[],
  labels: Readonly<Record<string, string>>,
): readonly FilterOption[] {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

/**
 * Seletor de filtro com a opção "todos".
 *
 * A sentinela `ANY_OPTION` fica encapsulada: quem usa passa e recebe
 * `undefined` para "sem filtro", e nunca vê o `"__all__"` que existia
 * declarado em seis arquivos.
 */
export function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  anyLabel = "Todos",
  disabled = false,
  className,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: readonly FilterOption[];
  anyLabel?: string;
  /**
   * Outro filtro já decidiu este.
   *
   * Existe porque filtros podem ser mutuamente exclusivos no contrato: no
   * Financeiro, "só vencidos" implica situação prevista, e o servidor recusa a
   * combinação. Desabilitar é melhor que deixar montar uma consulta que
   * voltaria 400 — ou, pior, corrigi-la em silêncio.
   */
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={toAnyOption(value)}
        onValueChange={(next) => onChange(fromAnyOption(next))}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={anyLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_OPTION}>{anyLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Barra de filtros: busca à esquerda, seletores, e o botão de limpar.
 *
 * A faixa é horizontal por padrão e só empilha quando a largura não dá para
 * mais nada. `auto-fill` mantém as trilhas vazias, então um controle tem a
 * mesma largura em todas as telas do produto — o filtro de Clientes não fica
 * três vezes maior que o de Orçamentos só porque a página tem menos filtros.
 *
 * A versão anterior era `minmax(0,2fr) repeat(auto-fit,minmax(9rem,1fr)) auto`.
 * `auto-fill`/`auto-fit` não podem dividir a lista com trilhas flexíveis ou
 * intrínsecas: a declaração inteira era inválida e o browser a descartava,
 * deixando `grid-template-columns: <largura da página>` — uma coluna só. Era
 * por isso que sete listagens empilhavam um filtro por linha até em 1440px.
 */
export function FilterBar({
  children,
  onClear,
  canClear,
  className,
}: {
  children: ReactNode;
  onClear?: () => void;
  canClear?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        "grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]",
        className,
      )}
    >
      {children}
      {onClear ? (
        /**
         * O botão é mais uma célula da faixa, encostado ao último filtro: é a
         * ação daqueles campos e some do olhar quando se separa deles. Em
         * telas estreitas, onde nem os filtros cabem numa linha, ele desce com
         * eles — continua adjacente, nunca numa faixa própria.
         */
        <div className="flex items-end">
          <Button variant="ghost" onClick={onClear} disabled={!canClear}>
            Limpar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contagem                                                            */
/* ------------------------------------------------------------------ */

/**
 * "1–20 de 137", ou o que houver.
 *
 * A contagem é sempre a do backend. A tela não soma nada — e quando o número
 * exibido é o da página, e não o do total, quem usa este componente diz isso
 * pelo `note`.
 */
export function ResultSummary({
  meta,
  noun,
  gender = "m",
  note,
  className,
}: {
  meta: ListMeta | undefined;
  /** Como chamar o que está sendo contado: "ativo", "operação"… */
  noun: string;
  /**
   * O gênero do substantivo, para a contagem concordar.
   *
   * "Nenhum operação" apareceu na validação em navegador — o texto era montado
   * com um artigo fixo e metade dos dezoito substantivos usados no produto é
   * feminina. Adivinhar pela terminação funcionaria para os que existem hoje e
   * erraria no primeiro "dia" ou "problema"; declarar custa uma palavra.
   */
  gender?: "m" | "f";
  note?: ReactNode;
  className?: string;
}) {
  const text = !meta
    ? "Carregando…"
    : meta.total === 0
      ? `${gender === "f" ? "Nenhuma" : "Nenhum"} ${noun}`
      : `${(meta.page - 1) * meta.limit + 1}–${Math.min(
          meta.page * meta.limit,
          meta.total,
        )} de ${meta.total}`;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3",
        className,
      )}
    >
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <ListFilter className="size-4" aria-hidden />
        <span>{text}</span>
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Paginação                                                           */
/* ------------------------------------------------------------------ */

/**
 * Paginação de uma listagem do backend.
 *
 * Só aparece quando há mais de uma página — uma paginação de página única é
 * ruído. Os botões seguem `hasNextPage` e `hasPreviousPage` **do servidor**, e
 * ficam inertes durante o carregamento para não empilhar pedidos.
 */
export function Pagination({
  meta,
  onPrevious,
  onNext,
  isFetching,
  className,
}: {
  meta: ListMeta | undefined;
  onPrevious: () => void;
  onNext: () => void;
  isFetching?: boolean;
  className?: string;
}) {
  if (!meta || meta.totalPages <= 1) return null;

  return (
    <div
      className={cn("flex items-center justify-between gap-3", className)}
      role="navigation"
      aria-label="Paginação"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={!meta.hasPreviousPage || isFetching}
        onClick={onPrevious}
      >
        Anterior
      </Button>
      <span className="text-sm text-muted-foreground">
        Página {meta.page} de {meta.totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={!meta.hasNextPage || isFetching}
        onClick={onNext}
      >
        Próxima
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Estados                                                             */
/* ------------------------------------------------------------------ */

/**
 * Carregando, erro, vazio ou conteúdo — nesta ordem, sempre.
 *
 * A ordem importa e é o que se perdia nas cópias: erro **antes** de vazio,
 * porque uma consulta que falhou tem zero itens e mostraria "nenhum resultado"
 * quando o certo é oferecer "tentar de novo".
 *
 * `children` é função para que o conteúdo só seja construído quando há o que
 * mostrar.
 */
export function ListState<TItem>({
  isPending,
  error,
  onRetry,
  items,
  empty,
  rows = 6,
  children,
}: {
  isPending: boolean;
  error: ApiError | null;
  onRetry?: () => void;
  items: readonly TItem[];
  empty: {
    icon?: ReactNode;
    title: string;
    description?: string;
    action?: ReactNode;
  };
  rows?: number;
  children: (items: readonly TItem[]) => ReactNode;
}) {
  if (isPending) return <PanelLoading rows={rows} />;
  if (error) return <PanelError error={error} onRetry={onRetry} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={empty.icon}
        title={empty.title}
        description={empty.description}
        action={empty.action}
      />
    );
  }
  return <>{children(items)}</>;
}
