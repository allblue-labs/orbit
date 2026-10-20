"use client";

/**
 * Filtros da lista de operações.
 *
 * Só expõe filtros que `OperationQueryDto` aceita de fato: busca, status,
 * tipo, prioridade e janela de agendamento. Nada é filtrado no cliente — a
 * paginação é do servidor, e filtrar localmente daria um resultado errado
 * para além da página atual.
 */
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  OperationKind,
  OperationPriority,
  OperationStatus,
} from "@/types/contracts";
import {
  FilterBar,
  FilterSelect,
  SearchField,
  optionsFrom,
} from "@/workspace";
import {
  OPERATION_KIND_LABELS,
  OPERATION_PRIORITY_LABELS,
  OPERATION_STATUS_LABELS,
  type OperationQuery,
} from "@/types/operations";

export interface OperationsFiltersProps {
  value: OperationQuery;
  onChange: (patch: Partial<OperationQuery>) => void;
  onReset: () => void;
  /** Termo digitado, controlado fora para permitir debounce. */
  searchTerm: string;
  onSearchTermChange: (term: string) => void;
}

export function OperationsFilters({
  value,
  onChange,
  onReset,
  searchTerm,
  onSearchTermChange,
}: OperationsFiltersProps) {
  const hasFilters = Boolean(
    value.search ||
    value.status ||
    value.kind ||
    value.priority ||
    value.scheduledFrom ||
    value.scheduledTo,
  );

  return (
    <FilterBar>
      <SearchField
        id="operations-search"
        value={searchTerm}
        onChange={onSearchTermChange}
        placeholder="Código, título ou descrição"
      />

      <FilterSelect
        id="operations-status"
        label="Status"
        value={value.status}
        options={optionsFrom(
          Object.values(OperationStatus),
          OPERATION_STATUS_LABELS,
        )}
        onChange={(status) =>
          onChange({ status: status as OperationQuery["status"] })
        }
      />

      <FilterSelect
        id="operations-kind"
        label="Tipo"
        value={value.kind}
        options={optionsFrom(
          Object.values(OperationKind),
          OPERATION_KIND_LABELS,
        )}
        onChange={(kind) => onChange({ kind: kind as OperationQuery["kind"] })}
      />

      <FilterSelect
        id="operations-priority"
        label="Prioridade"
        value={value.priority}
        options={optionsFrom(
          Object.values(OperationPriority),
          OPERATION_PRIORITY_LABELS,
        )}
        onChange={(priority) =>
          onChange({ priority: priority as OperationQuery["priority"] })
        }
      />

      <div className="flex items-end">
        <Button
          type="button"
          variant="ghost"
          onClick={onReset}
          disabled={!hasFilters}
        >
          <X className="size-4" />
          Limpar
        </Button>
      </div>
    </FilterBar>
  );
}
