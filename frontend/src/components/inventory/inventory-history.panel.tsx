"use client";

/**
 * Histórico de movimentações.
 *
 * ## O livro é imutável, e a tela reflete isso
 *
 * Não há botão de editar nem de excluir em nenhuma linha. Movimento confirmado
 * é append-only no backend, e oferecer a ação aqui prometeria algo que a API
 * recusaria — pior, sugeriria que corrigir estoque é apagar o passado. Correção
 * é ajuste, e ajuste é uma linha nova.
 *
 * ## `balanceAfter` é o que torna o livro auditável
 *
 * Cada linha mostra o saldo que a unidade passou a ter depois daquele
 * movimento — gravado pelo servidor na mesma instrução que o produziu. É o que
 * permite conferir a sequência sem refazer nenhuma conta.
 *
 * Todos os filtros são do contrato; nenhum recorte acontece no cliente.
 */
import { History } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityLink } from "@/entities";
import { useInventoryMovements } from "@/hooks/inventory/use-inventory";
import { useActiveScope } from "@/providers/use-active-scope";
import { formatDateTime } from "@/lib/formatters";
import {
  INVENTORY_TYPE_LABELS,
  type InventoryMovement,
  type InventoryMovementQuery,
  type InventoryMovementType,
} from "@/types/inventory";
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
import { MovementTypeBadge, Quantity } from "./inventory-presentation";

const TYPE_OPTIONS = optionsFrom(
  [
    "ENTRY",
    "CONSUMPTION",
    "RETURN",
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "TRANSFER_IN",
    "TRANSFER_OUT",
  ],
  INVENTORY_TYPE_LABELS,
);

const SOURCE_OPTIONS = [
  { value: "MANUAL", label: "Digitado" },
  { value: "OPERATION", label: "Ordem de serviço" },
  { value: "SYSTEM", label: "Automático" },
];

export function InventoryHistoryPanel({
  /** Recorte fixo — usado no detalhe do item e na operação. */
  catalogItemId,
  operationId,
  compact = false,
}: {
  catalogItemId?: string;
  operationId?: string;
  compact?: boolean;
}) {
  const list = useListController<InventoryMovementQuery>({
    limit: compact ? 10 : 20,
  });
  const { businessUnits } = useActiveScope();

  const query = useInventoryMovements({
    ...list.query,
    catalogItemId: catalogItemId ?? list.query.catalogItemId,
    operationId: operationId ?? list.query.operationId,
  });

  const movements = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-5">
      <ResultSummary
        meta={meta}
        noun="movimentação"
        gender="f"
        note="Do mais recente. O histórico não é editável."
      />

      {compact ? null : (
        <FilterBar onClear={list.reset} canClear={list.isFiltered}>
          <SearchField
            id="inventory-history-search"
            value={list.searchTerm}
            onChange={list.setSearchTerm}
            placeholder="Motivo, observação ou item"
            hint="A busca cobre motivo, observações e nome do item."
          />

          <FilterSelect
            id="inventory-history-type"
            label="Tipo"
            value={list.query.type}
            onChange={(value) =>
              list.setFilter("type", value as InventoryMovementType | undefined)
            }
            options={TYPE_OPTIONS}
          />

          {businessUnits.length > 1 ? (
            <FilterSelect
              id="inventory-history-unit"
              label="Unidade"
              value={list.query.businessUnitId}
              onChange={(value) => list.setFilter("businessUnitId", value)}
              options={businessUnits.map((unit) => ({
                value: unit.id,
                label: unit.tradeName ?? unit.legalName,
              }))}
              anyLabel="Todas"
            />
          ) : null}

          <FilterSelect
            id="inventory-history-source"
            label="Origem"
            value={list.query.source}
            onChange={(value) => list.setFilter("source", value)}
            options={SOURCE_OPTIONS}
          />

          <div className="space-y-2">
            <Label htmlFor="inventory-history-from">De</Label>
            <Input
              id="inventory-history-from"
              type="date"
              value={list.query.from ?? ""}
              onChange={(event) =>
                list.setFilter("from", event.target.value || undefined)
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="inventory-history-to">Até</Label>
            <Input
              id="inventory-history-to"
              type="date"
              value={list.query.to ?? ""}
              onChange={(event) =>
                list.setFilter("to", event.target.value || undefined)
              }
            />
          </div>
        </FilterBar>
      )}

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={movements}
        empty={{
          icon: <History className="size-5" />,
          title: "Nenhuma movimentação",
          description:
            "Entradas, consumos, devoluções, ajustes e transferências aparecem aqui — e nunca saem.",
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Tipo</TableHead>
                  {catalogItemId ? null : <TableHead>Item</TableHead>}
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Saldo após</TableHead>
                  <TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((movement) => (
                  <MovementRow
                    key={movement.id}
                    movement={movement}
                    hideItem={Boolean(catalogItemId)}
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
    </div>
  );
}

function MovementRow({
  movement,
  hideItem,
}: {
  movement: InventoryMovement;
  hideItem: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">
        <span className="block text-sm">
          {formatDateTime(movement.createdAt)}
        </span>
        <span className="block text-xs">{movement.createdBy.displayName}</span>
      </TableCell>

      <TableCell>
        <MovementTypeBadge movement={movement} />
        {movement.reason ? (
          <span className="mt-0.5 block max-w-52 truncate text-xs text-muted-foreground">
            {movement.reason}
          </span>
        ) : null}
      </TableCell>

      {hideItem ? null : (
        <TableCell>
          <span className="text-sm">{movement.item.name}</span>
          {movement.item.sku ? (
            <span className="block font-mono text-xs text-muted-foreground">
              {movement.item.sku}
            </span>
          ) : null}
        </TableCell>
      )}

      <TableCell className="text-muted-foreground">
        {movement.businessUnit.name}
      </TableCell>

      <TableCell className="text-right">
        <Quantity
          value={movement.quantity}
          unit={movement.item.unit}
          className={
            movement.direction === "IN" ? "text-emerald-400" : "text-rose-400"
          }
        />
      </TableCell>

      <TableCell className="text-right text-muted-foreground">
        <Quantity value={movement.balanceAfter} />
      </TableCell>

      <TableCell>
        {movement.operation ? (
          <EntityLink entity="operation" id={movement.operation.id}>
            {movement.operation.code}
          </EntityLink>
        ) : movement.transfer ? (
          /*
            A contraparte vem só como id — o contrato não publica o nome, e
            inventá-lo aqui exigiria uma segunda consulta por linha. O extrato
            da outra unidade mostra o outro lado com o nome dela.
          */
          <span className="text-xs text-muted-foreground">
            Transferência entre unidades
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {movement.origin.source === "MANUAL" ? "Digitado" : "Automático"}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
