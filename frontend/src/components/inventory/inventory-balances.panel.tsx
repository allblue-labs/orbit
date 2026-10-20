"use client";

/**
 * Saldos por item e unidade.
 *
 * ## Quatro números, nunca um
 *
 * Em estoque, reservado, disponível e mínimo respondem perguntas diferentes.
 * Resumi-los em "saldo" apagaria a distinção justo quando ela passar a
 * existir — hoje `reserved` é sempre zero, e amanhã não será.
 *
 * ## Nada é filtrado aqui
 *
 * `lowStock`, unidade, item e busca são parâmetros do contrato. `meta.total` é
 * do servidor. A tela não percorre registros para contar nada.
 */
import { useState } from "react";
import { Boxes, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { useInventoryBalances } from "@/hooks/inventory/use-inventory";
import { useActiveScope } from "@/providers/use-active-scope";
import type { InventoryBalance, InventoryBalanceQuery } from "@/types/inventory";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  useListController,
} from "@/workspace";
import { InventoryMinimumDialog } from "./inventory-minimum.dialog";
import {
  InventoryMovementDialog,
  type MovementKind,
} from "./inventory-movement.dialog";
import { InventoryTransferDialog } from "./inventory-transfer.dialog";
import {
  Quantity,
  ReservedNotice,
  StockStatusBadge,
} from "./inventory-presentation";

const LOW_OPTIONS = [
  { value: "true", label: "Baixo ou zerado" },
] as const;

export function InventoryBalancesPanel() {
  const list = useListController<InventoryBalanceQuery>({ limit: 20 });
  const { businessUnits } = useActiveScope();
  const query = useInventoryBalances(list.query);

  const [movement, setMovement] = useState<{
    kind: MovementKind;
    balance: InventoryBalance;
  } | null>(null);
  const [transfer, setTransfer] = useState<InventoryBalance | null>(null);
  const [minimum, setMinimum] = useState<InventoryBalance | null>(null);

  const balances = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-5">
      <ResultSummary
        meta={meta}
        noun="item em estoque"
        note="Um saldo por item e unidade"
      />

      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <SearchField
          id="inventory-balances-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Nome ou SKU do item"
          hint="A busca cobre nome e SKU."
        />

        {businessUnits.length > 1 ? (
          <FilterSelect
            id="inventory-balances-unit"
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
          id="inventory-balances-low"
          label="Situação"
          value={list.query.lowStock ? "true" : undefined}
          onChange={(value) =>
            list.setFilter("lowStock", value === "true" ? true : undefined)
          }
          options={LOW_OPTIONS}
          anyLabel="Todas"
        />
      </FilterBar>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={balances}
        empty={{
          icon: <Boxes className="size-5" />,
          title: "Nenhum item com saldo",
          description:
            "Registre uma entrada para começar a controlar um produto ou peça. Serviços não têm estoque.",
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Em estoque</TableHead>
                  <TableHead className="text-right">Reservado</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((balance) => (
                  <BalanceRow
                    key={balance.id}
                    balance={balance}
                    onMovement={(kind) => setMovement({ kind, balance })}
                    onTransfer={() => setTransfer(balance)}
                    onMinimum={() => setMinimum(balance)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <ReservedNotice />

      <Pagination
        meta={meta}
        onPrevious={list.previousPage}
        onNext={list.nextPage}
        isFetching={query.isFetching}
      />

      {movement ? (
        <InventoryMovementDialog
          kind={movement.kind}
          item={movement.balance.item}
          businessUnitId={movement.balance.businessUnit.id}
          currentOnHand={movement.balance.onHand}
          open
          onOpenChange={(open) => {
            if (!open) setMovement(null);
          }}
        />
      ) : null}

      {transfer ? (
        <InventoryTransferDialog
          item={transfer.item}
          fromBusinessUnitId={transfer.businessUnit.id}
          currentOnHand={transfer.onHand}
          open
          onOpenChange={(open) => {
            if (!open) setTransfer(null);
          }}
        />
      ) : null}

      <InventoryMinimumDialog
        balance={minimum}
        open={minimum !== null}
        onOpenChange={(open) => {
          if (!open) setMinimum(null);
        }}
      />
    </div>
  );
}

function BalanceRow({
  balance,
  onMovement,
  onTransfer,
  onMinimum,
}: {
  balance: InventoryBalance;
  onMovement: (kind: MovementKind) => void;
  onTransfer: () => void;
  onMinimum: () => void;
}) {
  const entry = useAction("catalog-item.stock-entry");
  const consumption = useAction("catalog-item.stock-consumption");
  const giveBack = useAction("catalog-item.stock-return");
  const adjustment = useAction("catalog-item.stock-adjustment");
  const transfer = useAction("catalog-item.stock-transfer");
  const minimum = useAction("catalog-item.stock-minimum");

  /** Uma capability comanda todas: `inventory.manage`. */
  const canManage = entry.allowed;

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{balance.item.name}</span>
        <span className="block text-xs text-muted-foreground">
          {balance.item.sku ? `${balance.item.sku} · ` : ""}
          {balance.item.unit}
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {balance.businessUnit.name}
      </TableCell>
      <TableCell className="text-right">
        <Quantity value={balance.onHand} className="font-medium" />
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        <Quantity value={balance.reserved} />
      </TableCell>
      <TableCell className="text-right">
        <Quantity value={balance.available} className="font-medium" />
      </TableCell>
      <TableCell className="text-right text-muted-foreground">
        <Quantity value={balance.minimumStock} />
      </TableCell>
      <TableCell>
        <StockStatusBadge status={balance.status} />
      </TableCell>
      <TableCell>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Ações de estoque">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onMovement("ENTRY")}>
                {entry.label}
              </DropdownMenuItem>
              {consumption.allowed ? (
                <DropdownMenuItem onSelect={() => onMovement("CONSUMPTION")}>
                  {consumption.label}
                </DropdownMenuItem>
              ) : null}
              {giveBack.allowed ? (
                <DropdownMenuItem onSelect={() => onMovement("RETURN")}>
                  {giveBack.label}
                </DropdownMenuItem>
              ) : null}
              {transfer.allowed ? (
                <DropdownMenuItem onSelect={onTransfer}>
                  {transfer.label}
                </DropdownMenuItem>
              ) : null}
              {minimum.allowed ? (
                <DropdownMenuItem onSelect={onMinimum}>
                  {minimum.label}
                </DropdownMenuItem>
              ) : null}
              {adjustment.allowed ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => onMovement("ADJUSTMENT_IN")}
                  >
                    Ajuste — sobra na contagem
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onMovement("ADJUSTMENT_OUT")}
                    className="text-destructive"
                  >
                    Ajuste — falta na contagem
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
