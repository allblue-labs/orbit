"use client";

/**
 * Estoque de um item, unidade a unidade.
 *
 * ## Serviço não tem estoque, e a tela diz isso
 *
 * `SERVICE` não recebe controle nenhum — nem saldo zero. Zero é um número, e
 * um número onde não deveria haver medida vira decisão errada de compra. A
 * seção explica que o item não é físico e para por aí.
 *
 * ## Sem total da organização
 *
 * Os saldos aparecem por unidade e **não são somados**. Somar filiais dá um
 * número que não corresponde a nenhuma prateleira, e é o tipo de total que
 * leva alguém a prometer uma peça que está a duzentos quilômetros.
 *
 * ## Preço vem do Catálogo, quantidade vem do Estoque
 *
 * Os dois contratos não se misturam: esta seção não mostra preço, e o painel
 * de preço não mostra quantidade.
 */
import { useState } from "react";
import { Boxes, MoreHorizontal, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PanelError, PanelLoading } from "@/components/panels";
import { useAction } from "@/actions";
import { useInventoryItem } from "@/hooks/inventory/use-inventory";
import { useSession } from "@/providers/session-provider";
import { isStockable, type InventoryBalance } from "@/types/inventory";
import { InventoryHistoryPanel } from "./inventory-history.panel";
import { InventoryMinimumDialog } from "./inventory-minimum.dialog";
import {
  InventoryMovementDialog,
  type MovementKind,
} from "./inventory-movement.dialog";
import { InventoryTransferDialog } from "./inventory-transfer.dialog";
import {
  BalanceFigures,
  ReservedNotice,
  StockStatusBadge,
} from "./inventory-presentation";

export function InventoryItemSection({
  item,
  /** Mostra o histórico do item abaixo dos saldos. */
  withHistory = true,
}: {
  item: { id: string; name: string; kind: string; unit: string };
  withHistory?: boolean;
}) {
  const session = useSession();

  /** Serviço: sem controle físico, e sem consulta que voltaria 400. */
  if (!isStockable(item.kind)) {
    return (
      <section className="space-y-2 rounded-xl border border-dashed border-border p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Wrench className="size-4 text-muted-foreground" aria-hidden />
          Sem controle físico
        </h3>
        <p className="text-sm text-muted-foreground">
          Serviços não têm estoque — uma hora de mão de obra não fica na
          prateleira. Não é possível movimentar itens deste tipo, e nenhum
          saldo é exibido aqui.
        </p>
      </section>
    );
  }

  if (!session.hasCapability("inventory.read")) {
    return (
      <section className="space-y-2 rounded-xl border border-dashed border-border p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Boxes className="size-4 text-muted-foreground" aria-hidden />
          Estoque
        </h3>
        <p className="text-sm text-muted-foreground">
          Seu acesso não inclui o estoque. Ele é concedido separadamente do
          catálogo.
        </p>
      </section>
    );
  }

  return <Balances item={item} withHistory={withHistory} />;
}

function Balances({
  item,
  withHistory,
}: {
  item: { id: string; name: string; kind: string; unit: string };
  withHistory: boolean;
}) {
  const query = useInventoryItem(item.id);
  const [movement, setMovement] = useState<{
    kind: MovementKind;
    balance: InventoryBalance;
  } | null>(null);
  const [transfer, setTransfer] = useState<InventoryBalance | null>(null);
  const [minimum, setMinimum] = useState<InventoryBalance | null>(null);
  const entry = useAction("catalog-item.stock-entry");

  if (query.isPending) return <PanelLoading rows={3} />;
  if (query.error) {
    return (
      <PanelError error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  const balances = query.data?.balances ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Boxes className="size-4 text-muted-foreground" aria-hidden />
          Estoque por unidade
        </h3>
        {entry.allowed ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setMovement({
                kind: "ENTRY",
                balance:
                  balances[0] ??
                  ({
                    item: { ...item, sku: null },
                    businessUnit: { id: "", name: "" },
                    onHand: "0.000",
                  } as InventoryBalance),
              })
            }
          >
            Registrar entrada
          </Button>
        ) : null}
      </div>

      {balances.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Este item ainda não tem saldo em nenhuma unidade. A primeira entrada
          cria o controle.
        </p>
      ) : (
        <ul className="space-y-3">
          {balances.map((balance) => (
            <li
              key={balance.id}
              className="space-y-3 rounded-lg border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {balance.businessUnit.name}
                  <StockStatusBadge status={balance.status} />
                </span>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" aria-label="Ações">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => setMovement({ kind: "ENTRY", balance })}
                    >
                      Registrar entrada
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setMovement({ kind: "CONSUMPTION", balance })
                      }
                    >
                      Registrar consumo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setMovement({ kind: "RETURN", balance })}
                    >
                      Registrar devolução
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setTransfer(balance)}>
                      Transferir
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setMinimum(balance)}>
                      Definir mínimo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setMovement({ kind: "ADJUSTMENT_IN", balance })
                      }
                    >
                      Ajuste — sobra
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setMovement({ kind: "ADJUSTMENT_OUT", balance })
                      }
                      className="text-destructive"
                    >
                      Ajuste — falta
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <BalanceFigures balance={balance} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Os saldos são por unidade e não se somam: um total da organização não
        corresponderia a nenhuma prateleira.
      </p>
      <ReservedNotice />

      {withHistory && balances.length > 0 ? (
        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium">Histórico do item</h3>
          <InventoryHistoryPanel catalogItemId={item.id} compact />
        </div>
      ) : null}

      {movement ? (
        <InventoryMovementDialog
          kind={movement.kind}
          item={{ ...item, sku: null }}
          businessUnitId={movement.balance.businessUnit.id || undefined}
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
