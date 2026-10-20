"use client";

/**
 * Escolha de cliente, carregada sob demanda.
 *
 * ## Por que rolagem infinita, e não uma lista inteira
 *
 * Uma empresa com dois mil clientes não cabe num `Select`: a resposta demora, o
 * navegador desenha dois mil nós, e quem procura rola até cansar. Aqui cada
 * página chega quando a anterior termina na tela — `GET /customers?page=N`, com
 * `meta.hasNextPage` decidindo se há mais.
 *
 * ## A busca é do servidor
 *
 * Filtrar no cliente filtraria **a página carregada**, e quem digitasse o nome
 * de alguém da página sete não encontraria nada — o pior tipo de "não existe",
 * porque parece resposta. `search` é parâmetro do contrato, e trocar o termo
 * recomeça a rolagem da primeira página.
 *
 * ## `modal` porque isto abre dentro de diálogos
 *
 * O conteúdo do `Popover` monta num portal, fora da árvore do `Dialog`. Sem
 * `modal`, o clique para abri-lo conta como interação **fora** do diálogo, e o
 * diálogo se fecha: o wizard desaparecia inteiro ao escolher o cliente. Com
 * `modal`, o Radix isola os ponteiros enquanto o painel está aberto, e o diálogo
 * deixa de ver o clique como saída.
 *
 * ## O cliente já escolhido aparece mesmo fora da lista
 *
 * Quem reabre um formulário salvo tem um `value` que pode estar na página doze,
 * ou num cliente que a busca atual não alcança. O rótulo vem de `selectedLabel`,
 * que quem chama já conhece — sem isso o campo mostraria o id, ou pior, pareceria
 * vazio e faria a pessoa escolher outro.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useInfiniteCustomers } from "@/hooks/customers/use-customers";
import { cn } from "@/lib/utils";
import { SEARCH_DEBOUNCE_MS } from "@/workspace";
import type { Customer } from "@/types/customers";

export function CustomerPicker({
  id,
  value,
  selectedLabel,
  onChange,
  placeholder = "Escolher cliente",
  /** Rótulo da opção que limpa a escolha. Ausente, não há como limpar. */
  anyLabel,
  disabled = false,
}: {
  id: string;
  value: string | undefined;
  selectedLabel?: string;
  onChange: (customer: Customer | null) => void;
  placeholder?: string;
  anyLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState("");

  /* O mesmo intervalo do resto do Workspace: digitar não dispara uma consulta
     por tecla. */
  useEffect(() => {
    const timer = setTimeout(() => setSearch(term.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const query = useInfiniteCustomers(search || undefined, open);
  /* `useInfiniteApiQuery` já entrega as páginas achatadas em um array — `data`
     é `PaginatedResult[]`, não o `InfiniteData` cru do React Query. */
  const customers = useMemo(
    () => (query.data ?? []).flatMap((page) => page.data),
    [query.data],
  );

  /* O rótulo de quem está escolhido: o que veio de fora, ou o que a lista já
     carregou. Cair no id seria mostrar dado de máquina onde vai um nome. */
  const chosen = customers.find((customer) => customer.id === value);
  const label =
    selectedLabel ??
    (chosen ? (chosen.tradeName ?? chosen.legalName) : undefined);

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-start font-normal"
        >
          <Users
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className={cn("truncate", !label && "text-muted-foreground")}>
            {label ?? placeholder}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search
              className="absolute top-2.5 left-2 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Buscar por nome ou documento"
              className="pl-8"
              autoFocus
            />
          </div>
        </div>

        <Results
          customers={customers}
          value={value}
          anyLabel={anyLabel}
          isPending={query.isPending}
          isFetchingNextPage={query.isFetchingNextPage}
          hasNextPage={query.hasNextPage}
          onLoadMore={() => void query.fetchNextPage()}
          onPick={(customer) => {
            onChange(customer);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function Results({
  customers,
  value,
  anyLabel,
  isPending,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  onPick,
}: {
  customers: readonly Customer[];
  value: string | undefined;
  anyLabel?: string;
  isPending: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  onPick: (customer: Customer | null) => void;
}) {
  const sentinel = useRef<HTMLDivElement>(null);

  /*
   * A página seguinte chega quando o fim da lista aparece.
   *
   * `IntersectionObserver` e não `onScroll`: o evento de rolagem dispara dezenas
   * de vezes por gesto e obrigaria a comparar alturas à mão, que erra com zoom e
   * com barra de rolagem sobreposta.
   */
  useEffect(() => {
    const alvo = sentinel.current;
    if (!alvo || !hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(alvo);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, onLoadMore]);

  if (isPending) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Carregando clientes…
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        Nenhum cliente encontrado.
      </p>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto p-1">
      {anyLabel ? (
        <Option
          label={anyLabel}
          selected={value === undefined}
          onSelect={() => onPick(null)}
        />
      ) : null}

      {customers.map((customer) => (
        <Option
          key={customer.id}
          label={customer.tradeName ?? customer.legalName}
          hint={customer.documentNumber}
          selected={customer.id === value}
          onSelect={() => onPick(customer)}
        />
      ))}

      <div ref={sentinel} aria-hidden />

      {isFetchingNextPage ? (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Carregando mais…
        </div>
      ) : null}
    </div>
  );
}

function Option({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm",
        "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        selected && "bg-accent",
      )}
    >
      <Check
        className={cn(
          "size-4 shrink-0",
          selected ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </button>
  );
}
