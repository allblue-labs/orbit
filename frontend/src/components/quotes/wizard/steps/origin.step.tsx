"use client";

/**
 * Passo 1 — de onde vêm os dados.
 *
 * ## Do zero é o padrão
 *
 * É o caso mais comum e o que não depende de nada existir. Se copiar fosse o
 * padrão, quem quisesse orçar algo novo teria de recusar uma escolha antes de
 * começar.
 *
 * ## O que a cópia traz, e o que não traz
 *
 * A tela **diz** que serviço com valor não vem. `Operation` não guarda linha de
 * serviço com preço — `kind` é categoria, não item de catálogo — e o servidor
 * copia apenas os materiais dos movimentos de consumo. Deixar a pessoa descobrir
 * isso no passo 3, olhando uma lista com metade do que esperava, faria parecer
 * defeito.
 */
import { ClipboardList, FilePlus2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useOperationsList } from "@/hooks/operations/use-operations";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { QuoteDraft, QuoteOrigin } from "../quote-wizard.model";

/** Quantos atendimentos concluídos oferecer. Os mais recentes são os que se orça. */
const RECENT_LIMIT = 15;

export function OriginStep({
  draft,
  onChange,
}: {
  draft: QuoteDraft;
  onChange: (patch: Partial<QuoteDraft>) => void;
}) {
  return (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Como começar</legend>

        <OriginCard
          value="SCRATCH"
          current={draft.origin}
          icon={FilePlus2}
          title="Orçamento novo"
          description="Você informa cliente, escopo e valores. É o caminho para propor algo que ainda não foi atendido."
          onSelect={(origin) => onChange({ origin, operationId: null })}
        />

        <OriginCard
          value="OPERATION"
          current={draft.origin}
          icon={ClipboardList}
          title="A partir de um atendimento concluído"
          description="Copia cliente, endereço, equipamentos, título e os materiais consumidos. Tudo fica editável."
          onSelect={(origin) => onChange({ origin })}
        />
      </fieldset>

      {draft.origin === "OPERATION" ? (
        <OperationChooser
          selected={draft.operationId}
          onSelect={(operationId) => onChange({ operationId })}
        />
      ) : null}
    </div>
  );
}

function OriginCard({
  value,
  current,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  value: QuoteOrigin;
  current: QuoteOrigin;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onSelect: (value: QuoteOrigin) => void;
}) {
  const selected = current === value;

  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={selected}
      className={cn(
        "flex w-full gap-3 rounded-xl border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-accent/50",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

/**
 * Os atendimentos que podem virar proposta.
 *
 * Só `COMPLETED`: copiar escopo de atendimento em andamento copiaria algo que
 * ainda vai mudar, e o servidor recusa. Filtrar aqui evita oferecer uma opção
 * cujo único destino é uma recusa.
 */
function OperationChooser({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (operationId: string) => void;
}) {
  const query = useOperationsList({
    status: "COMPLETED",
    page: 1,
    limit: RECENT_LIMIT,
  });

  const operations = query.data?.data ?? [];

  return (
    <div className="space-y-2">
      <Label>Atendimento de origem</Label>

      {query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : operations.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Nenhum atendimento concluído ainda. Um orçamento só copia de
          atendimento concluído — o escopo de um em andamento ainda vai mudar.
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto">
          {operations.map((operation) => (
            <li key={operation.id}>
              <button
                type="button"
                onClick={() => onSelect(operation.id)}
                aria-pressed={selected === operation.id}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  selected === operation.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <span className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    {operation.code}
                  </Badge>
                  <span className="min-w-0 truncate text-sm">
                    {operation.title}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {operation.customer
                    ? (operation.customer.tradeName ??
                      operation.customer.legalName)
                    : "Sem cliente"}
                  {operation.completedAt
                    ? ` · concluído em ${formatDate(operation.completedAt)}`
                    : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Os <strong>materiais</strong> consumidos vêm como itens, com preço do
        Catálogo. <strong>Serviços não vêm</strong>: o atendimento não guarda
        linha de serviço com valor, e inventá-la daria um preço que ninguém
        combinou. Você acrescenta os serviços no passo seguinte.
      </p>
    </div>
  );
}
