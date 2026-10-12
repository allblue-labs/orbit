"use client";

/**
 * Aba de lançamentos — serve Lançamentos, Receitas e Despesas.
 *
 * ## Um componente, três abas
 *
 * Receita e despesa são o **mesmo registro** com `type` diferente, e `type` é
 * filtro do servidor. Três listagens quase idênticas seriam a duplicação que o
 * Workspace Core existe para evitar: o que muda entre elas é o filtro fixo, o
 * substantivo da contagem e o texto do vazio — três props.
 *
 * ## Nada é recortado no cliente
 *
 * Todo filtro desta barra é parâmetro de `FinancialEntryQueryDto`. A tela não
 * filtra array, não soma coluna e não conta total: `meta.total` é do servidor,
 * e é ele quem responde quantos lançamentos existem.
 *
 * ## Vencido é filtro, não cor calculada
 *
 * `overdue=true` é do servidor, que compara contra o próprio relógio. O
 * servidor **recusa** combiná-lo com situação diferente de prevista — vencido
 * é previsto por definição —, então a barra desativa o seletor de situação
 * quando o filtro está ligado, em vez de deixar montar uma consulta que
 * voltaria 400.
 */
import { useState } from "react";
import { MoreHorizontal, Plus, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/actions";
import { EntityBadge, EntityLink } from "@/entities";
import {
  useConfirmFinancialEntry,
  useFinancialCategories,
  useFinancialEntries,
} from "@/hooks/financial/use-financial";
import { useActiveScope } from "@/providers/use-active-scope";
import {
  FINANCIAL_SOURCE_LABELS,
  FINANCIAL_STATUS_LABELS,
  FINANCIAL_TYPE_LABELS,
  type FinancialEntry,
  type FinancialEntryQuery,
  type FinancialEntryType,
} from "@/types/financial";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  optionsFrom,
  useListController,
} from "@/workspace";
import { FinancialCancelDialog } from "../financial-cancel.dialog";
import { FinancialEntryFormDialog } from "../financial-entry-form.dialog";
import { FinancialEntrySheet } from "../financial-entry.sheet";
import { CompetenceDate, Money, OverdueMark } from "../financial-presentation";

const STATUS_OPTIONS = optionsFrom(
  ["PENDING", "CONFIRMED", "CANCELLED"],
  FINANCIAL_STATUS_LABELS,
);

const TYPE_OPTIONS = optionsFrom(["INCOME", "EXPENSE"], FINANCIAL_TYPE_LABELS);

const SOURCE_OPTIONS = optionsFrom(
  ["MANUAL", "RECEIPT", "QUOTE", "SYSTEM"],
  FINANCIAL_SOURCE_LABELS,
);

export function FinancialEntriesTab({
  /** Fixa o lado. `undefined` na aba geral, onde o usuário escolhe. */
  type,
  noun,
  gender,
  emptyTitle,
  emptyDescription,
}: {
  type?: FinancialEntryType;
  noun: string;
  /** Gênero do substantivo, repassado para a contagem concordar. */
  gender?: "m" | "f";
  emptyTitle: string;
  emptyDescription: string;
}) {
  const list = useListController<FinancialEntryQuery>({ limit: 20 });
  const { businessUnits } = useActiveScope();
  const categories = useFinancialCategories(type ? { type } : undefined);

  const query = useFinancialEntries({ ...list.query, type });

  const create = useAction("financial-entry.create");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FinancialEntry | null>(null);
  const [selected, setSelected] = useState<FinancialEntry | null>(null);
  const [cancelling, setCancelling] = useState<FinancialEntry | null>(null);

  const confirm = useConfirmFinancialEntry();

  const entries = query.data?.data ?? [];
  const meta = query.data?.meta;

  const openNew = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (entry: FinancialEntry) => {
    setSelected(null);
    setEditing(entry);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultSummary
          meta={meta}
          noun={noun}
          gender={gender}
          note="Ordenado por competência, do mais recente"
        />
        {create.allowed ? (
          <Button size="sm" onClick={openNew}>
            <Plus className="size-4" />
            {create.label}
          </Button>
        ) : null}
      </div>

      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <SearchField
          id={`financial-${type ?? "all"}-search`}
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Descrição ou observações"
          hint="A busca cobre descrição e observações."
        />

        {type ? null : (
          <FilterSelect
            id="financial-type"
            label="Sentido"
            value={list.query.type}
            onChange={(value) =>
              list.setFilter("type", value as FinancialEntryType | undefined)
            }
            options={TYPE_OPTIONS}
          />
        )}

        <FilterSelect
          id={`financial-${type ?? "all"}-status`}
          label="Situação"
          value={list.query.status}
          onChange={(value) =>
            list.setFilter("status", value as FinancialEntryQuery["status"])
          }
          options={STATUS_OPTIONS}
          disabled={list.query.overdue === true}
        />

        <FilterSelect
          id={`financial-${type ?? "all"}-category`}
          label="Categoria"
          value={list.query.categoryId}
          onChange={(value) => list.setFilter("categoryId", value)}
          options={(categories.data ?? []).map((category) => ({
            value: category.id,
            label: category.name,
          }))}
          anyLabel="Todas"
        />

        <FilterSelect
          id={`financial-${type ?? "all"}-source`}
          label="Origem"
          value={list.query.source}
          onChange={(value) =>
            list.setFilter("source", value as FinancialEntryQuery["source"])
          }
          options={SOURCE_OPTIONS}
        />

        {businessUnits.length > 1 ? (
          <FilterSelect
            id={`financial-${type ?? "all"}-unit`}
            label="Organização"
            value={list.query.businessUnitId}
            onChange={(value) => list.setFilter("businessUnitId", value)}
            options={businessUnits.map((unit) => ({
              value: unit.id,
              label: unit.tradeName ?? unit.legalName,
            }))}
            anyLabel="Todas"
          />
        ) : null}

        <PeriodFields list={list} type={type} />

        <label className="flex items-center gap-2 self-end pb-1 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-primary)]"
            checked={list.query.overdue === true}
            onChange={(event) => {
              const overdue = event.target.checked;
              /** Vencido é previsto — mandar outra situação junto vira 400. */
              list.patch(
                overdue
                  ? { overdue: true, status: undefined }
                  : { overdue: undefined },
              );
            }}
          />
          Só vencidos
        </label>
      </FilterBar>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={entries}
        empty={{
          icon: <Wallet className="size-5" />,
          title: emptyTitle,
          description: emptyDescription,
          action: create.allowed ? (
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" />
              {create.label}
            </Button>
          ) : undefined,
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Competência</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    onOpen={() => setSelected(entry)}
                    onEdit={() => openEdit(entry)}
                    onConfirm={() =>
                      confirm.mutate({ id: entry.id, input: {} })
                    }
                    onCancel={() => setCancelling(entry)}
                    isConfirming={
                      confirm.isPending && confirm.variables?.id === entry.id
                    }
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

      <FinancialEntryFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        defaultType={type ?? "INCOME"}
      />

      <FinancialEntrySheet
        entry={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onEdit={openEdit}
        onConfirm={(entry) => {
          setSelected(null);
          confirm.mutate({ id: entry.id, input: {} });
        }}
        onCancel={(entry) => {
          setSelected(null);
          setCancelling(entry);
        }}
      />

      <FinancialCancelDialog
        entry={cancelling}
        onOpenChange={(open) => {
          if (!open) setCancelling(null);
        }}
      />
    </div>
  );
}

/**
 * Recorte de competência.
 *
 * Dois campos de data em vez de um seletor de "últimos 30 dias": competência é
 * mês fechado no vocabulário de quem cuida do caixa, e o contrato aceita
 * exatamente `from` e `to`.
 */
function PeriodFields({
  list,
  type,
}: {
  list: ReturnType<typeof useListController<FinancialEntryQuery>>;
  type?: FinancialEntryType;
}) {
  const id = type ?? "all";
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`financial-${id}-from`}>De</Label>
        <Input
          id={`financial-${id}-from`}
          type="date"
          value={list.query.from ?? ""}
          onChange={(event) =>
            list.setFilter("from", event.target.value || undefined)
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`financial-${id}-to`}>Até</Label>
        <Input
          id={`financial-${id}-to`}
          type="date"
          value={list.query.to ?? ""}
          onChange={(event) =>
            list.setFilter("to", event.target.value || undefined)
          }
        />
      </div>
    </>
  );
}

function EntryRow({
  entry,
  onOpen,
  onEdit,
  onConfirm,
  onCancel,
  isConfirming,
}: {
  entry: FinancialEntry;
  onOpen: () => void;
  onEdit: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming: boolean;
}) {
  const edit = useAction("financial-entry.update");
  const confirm = useAction("financial-entry.confirm");
  const cancel = useAction("financial-entry.cancel");

  /** `editable` já combina origem e situação — do servidor, não daqui. */
  const canEdit = edit.allowed && entry.editable;
  const canConfirm = confirm.allowed && entry.status === "PENDING";
  const canCancel = cancel.allowed && entry.status !== "CANCELLED";
  const hasMenu = canEdit || canConfirm || canCancel;

  return (
    <TableRow className="cursor-pointer" onClick={onOpen}>
      <TableCell className="text-muted-foreground">
        <CompetenceDate value={entry.competenceDate} />
      </TableCell>
      <TableCell>
        <span className="font-medium">{entry.description}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {entry.businessUnit.name}
          {entry.customer ? (
            <span onClick={(event) => event.stopPropagation()}>
              <EntityLink entity="customer" id={entry.customer.id}>
                {entry.customer.displayName}
              </EntityLink>
            </span>
          ) : null}
          <OverdueMark overdue={entry.isOverdue} />
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {entry.category?.name ?? "—"}
      </TableCell>
      <TableCell>
        <EntityBadge
          entity="financial-entry"
          group="source"
          value={entry.origin.source}
        />
      </TableCell>
      <TableCell>
        <EntityBadge
          entity="financial-entry"
          group="status"
          value={entry.status}
        />
      </TableCell>
      <TableCell className="text-right">
        <Money
          value={entry.amount}
          type={entry.type}
          signed
          muted={entry.status === "CANCELLED"}
        />
      </TableCell>
      <TableCell onClick={(event) => event.stopPropagation()}>
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Ações"
                disabled={isConfirming}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canConfirm ? (
                <DropdownMenuItem onSelect={onConfirm}>
                  {confirm.label}
                </DropdownMenuItem>
              ) : null}
              {canEdit ? (
                <DropdownMenuItem onSelect={onEdit}>
                  {edit.label}
                </DropdownMenuItem>
              ) : null}
              {canCancel ? (
                <DropdownMenuItem
                  onSelect={onCancel}
                  className="text-destructive"
                >
                  {cancel.label}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
