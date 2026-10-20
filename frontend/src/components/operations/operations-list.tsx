"use client";

/**
 * Lista de operações.
 *
 * Paginação, busca e filtros são do servidor (`OperationQueryDto`). A seleção
 * é local e serve para ações em lote futuras — hoje ela apenas informa quantas
 * operações estão marcadas, porque o backend ainda não expõe endpoint de ação
 * em lote.
 *
 * ## Centro de gestão (PR-12)
 *
 * A lista deixou de ser só leitura: criar, editar, reagendar, reatribuir,
 * alterar prioridade, mudar status e excluir acontecem aqui, sem abrir a
 * operação. Cada ação chama um endpoint que já existia — ver
 * `operation-actions.tsx`.
 *
 * Os acessos rápidos a cliente, equipamento e execuções de artefato usam o
 * **Entity Registry**: nenhuma rota é montada à mão nesta tela, e uma entidade
 * sem tela registrada simplesmente não vira link.
 *
 * **Ordenação**: `OperationQueryDto` não aceita parâmetro de ordenação. O
 * backend ordena por `scheduledStart asc, createdAt desc`. Ordenar no cliente
 * reordenaria apenas a página atual e daria uma impressão falsa de ordem
 * global, então a coluna não é clicável e a ordem do backend é declarada no
 * cabeçalho. Ver `docs/operations-workspace.md`.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityLink } from "@/entities/entity-components";
import { useSchedulingTimeZone } from "@/components/scheduling/use-scheduling-timezone";
import { useOperationsList } from "@/hooks/operations/use-operations";
import { useAction } from "@/actions";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/routes";
import type { OperationListItem, OperationQuery } from "@/types/operations";
import {
  operationKindLabel,
  operationPriorityLabel,
  OperationStatusBadge,
} from "./operation-badges";
import { OperationActions } from "./operation-actions";
import { OperationFormDialog } from "./operation-form.dialog";
import { OperationsFilters } from "./operations-filters";
import { resumoDaEquipe } from "./operation-team-summary";
import {
  ListState,
  Pagination,
  ResultSummary,
  useListController,
} from "@/workspace";

export function OperationsList() {
  const { timeZone } = useSchedulingTimeZone();
  const list = useListController<OperationQuery>({ limit: 20 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<OperationListItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  /** Exigências declaradas no Action Registry, não repetidas aqui. */
  const canCreate = useAction("operation.create").allowed;

  const query = useOperationsList(list.query);
  const operations = query.data?.data ?? [];
  const meta = query.data?.meta;

  const allSelected =
    operations.length > 0 && operations.every((item) => selected.has(item.id));

  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(operations.map((item) => item.id)),
    );
  };

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Filtrar limpa a seleção.
   *
   * A seleção é por id, e os ids somem quando a lista muda — manter uma
   * seleção que não está mais na tela levaria a uma ação em lote sobre
   * registros invisíveis.
   */
  const applyFilters = (patch: Partial<OperationQuery>) => {
    list.patch(patch);
    setSelected(new Set());
  };

  const resetFilters = () => {
    list.reset();
    setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <OperationsFilters
        value={list.query}
        onChange={applyFilters}
        onReset={resetFilters}
        searchTerm={list.searchTerm}
        onSearchTermChange={list.setSearchTerm}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <ResultSummary meta={meta} noun="operação" gender="f" />
          {selected.size > 0 ? (
            <Badge variant="secondary">{selected.size} selecionadas</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            Ordenado por agendamento e data de criação
          </p>
          {canCreate ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              Nova operação
            </Button>
          ) : null}
        </div>
      </div>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={operations}
        empty={{
          title: "Nenhuma operação encontrada",
          description:
            "Ajuste os filtros ou limpe a busca para ver mais resultados.",
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Selecionar todas as operações da página"
                    />
                  </TableHead>
                  <TableHead>Operação</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Agendamento</TableHead>
                  <TableHead>Equipe</TableHead>
                  <TableHead>Acesso rápido</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((operation) => (
                  <OperationRow
                    key={operation.id}
                    operation={operation}
                    selected={selected.has(operation.id)}
                    timeZone={timeZone}
                    onToggle={() => toggleOne(operation.id)}
                    onEdit={() => {
                      setEditing(operation);
                      setFormOpen(true);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <Pagination
        meta={meta}
        onPrevious={list.previousPage}
        onNext={list.nextPage}
        isFetching={query.isFetching}
      />

      <OperationFormDialog
        open={formOpen}
        editing={editing}
        timeZone={timeZone}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
      />
    </div>
  );
}

function OperationRow({
  operation,
  selected,
  timeZone,
  onToggle,
  onEdit,
}: {
  operation: OperationListItem;
  selected: boolean;
  timeZone: string;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    <TableRow className={cn(selected && "bg-secondary/40")}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Selecionar operação ${operation.serviceOrderCode ?? operation.code}`}
        />
      </TableCell>
      <TableCell>
        <Link
          href={`${ROUTES.operations}/${operation.id}`}
          className="block min-w-0 space-y-0.5 hover:underline"
        >
          <span className="block truncate font-medium">{operation.title}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {/*
              O número da OS vem primeiro, quando existe.

              É por ele que o cliente liga e a nota fiscal referencia — o `code` é
              a convenção interna de quem criou a operação. Operações de PMOC e RVT
              não têm número de ordem, e aí o código é o que identifica.
            */}
            {operation.serviceOrderCode ?? operation.code} ·{" "}
            {operationKindLabel(operation.kind)} ·{" "}
            {operationPriorityLabel(operation.priority)}
          </span>
        </Link>
      </TableCell>
      <TableCell>
        <OperationStatusBadge status={operation.status} />
      </TableCell>
      <TableCell className="max-w-40 truncate text-sm text-muted-foreground">
        {operation.customer?.tradeName ?? operation.customer?.legalName ?? "—"}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatDateTime(operation.scheduledStart)}
      </TableCell>
      {/*
        A equipe sai do modelo de campo, e não de `operation.users`.

        `users` é a tabela genérica de participação, escrita pela rota `assign` e
        pelo PMOC quando uma execução começa. Atribuir no formulário grava
        `responsibleFieldTechnicianId` e os auxiliares — o modelo que o aplicativo
        filtra. Lendo `users`, a listagem dizia "Sem técnico" para um atendimento
        que já estava no celular do técnico.
      */}
      <TableCell className="text-sm text-muted-foreground">
        {resumoDaEquipe(operation)}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {operation.customer ? (
            <EntityLink entity="customer" id={operation.customer.id}>
              {operation.customer.tradeName ?? operation.customer.legalName}
            </EntityLink>
          ) : null}
          {/*
            Um link por equipamento.

            Era um só. Juntar os nomes num texto tiraria o caminho para cada
            ficha — e é a ficha que diz o histórico daquele aparelho.
          */}
          {operation.assets.map((equipamento) => (
            <EntityLink key={equipamento.id} entity="asset" id={equipamento.id}>
              {equipamento.name}
            </EntityLink>
          ))}
          {operation.checklistExecutions.length > 0 ? (
            <span className="text-muted-foreground">
              {operation.checklistExecutions.length} checklist(s)
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-0.5">
          <OperationActions
            operation={operation}
            timeZone={timeZone}
            onEdit={onEdit}
          />
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Abrir operação"
          >
            <Link href={`${ROUTES.operations}/${operation.id}`}>
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
