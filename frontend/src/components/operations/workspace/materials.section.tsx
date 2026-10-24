"use client";

/**
 * Materiais utilizados na operação.
 *
 * ## Consumo é o que se usou, não o que se orçou
 *
 * Nada aqui vem do orçamento. Proposta é intenção comercial; o que sai da
 * prateleira numa visita costuma diferir — falta uma peça, sobra outra, o
 * técnico troca por equivalente. Deduzir do orçamento daria baixa em material
 * que ninguém tirou do estoque.
 *
 * ## De onde vem
 *
 * `GET /inventory/movements?operationId=` — recorte do servidor. A seção lista
 * o que foi consumido e o que voltou, porque devolução também é fato da visita.
 *
 * ## Registrar consumo daqui
 *
 * `POST /inventory/consumptions` aceita `operationId`, então a ação existe sem
 * contrato novo. A unidade padrão é a da operação: o material sai da
 * prateleira de quem executa.
 */
import { useState } from "react";
import { PackageMinus, Plus } from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { useAction } from "@/actions";
import { useInventoryMovements } from "@/hooks/inventory/use-inventory";
import { useSession } from "@/providers/session-provider";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { Operation } from "@/types/operations";
import {
  MovementTypeBadge,
  Quantity,
} from "@/components/inventory/inventory-presentation";
import { OperationMaterialDialog } from "./operation-material.dialog";

export function MaterialsSection({
  operation,
}: {
  operation: Pick<Operation, "id" | "businessUnitId"> | undefined;
}) {
  const session = useSession();

  /**
   * Sem `inventory.read`, a seção não aparece.
   *
   * Não é o mesmo que "não há material": é que esta pessoa não tem acesso ao
   * estoque, concedido separadamente do acesso à operação. Consultar assim
   * mesmo devolveria 403 a cada abertura da ordem de serviço.
   */
  if (!operation || !session.hasCapability("inventory.read")) return null;

  return <Materials operation={operation} />;
}

function Materials({
  operation,
}: {
  operation: Pick<Operation, "id" | "businessUnitId">;
}) {
  const { formatDateTime } = useDateFormatters();
  const query = useInventoryMovements({
    operationId: operation.id,
    limit: 50,
  });
  const register = useAction("catalog-item.stock-consumption");
  const [open, setOpen] = useState(false);

  return (
    <PanelFrame
      panelId="operation-materials"
      title="Materiais utilizados"
      description="Baixa de estoque desta ordem de serviço"
      actions={
        register.allowed ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            Registrar material
          </Button>
        ) : null
      }
    >
      <PanelState
        query={toPanelQuery(query)}
        isEmpty={(page) => page.data.length === 0}
        emptyMessage="Nenhum material registrado nesta operação."
      >
        {(page) => (
          <ul className="space-y-2">
            {page.data.map((movement) => (
              <li
                key={movement.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {movement.item.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {movement.businessUnit.name} ·{" "}
                    {formatDateTime(movement.createdAt)} ·{" "}
                    {movement.createdBy.displayName}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  <MovementTypeBadge movement={movement} />
                  <Quantity
                    value={movement.quantity}
                    unit={movement.item.unit}
                    className={
                      movement.direction === "IN"
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelState>

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <PackageMinus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          O que aparece aqui é o material que{" "}
          <strong>saiu da prateleira</strong> por causa desta operação —
          registrado por quem esteve em campo. Nada é deduzido de orçamento.
        </span>
      </p>

      <OperationMaterialDialog
        operationId={operation.id}
        businessUnitId={operation.businessUnitId}
        open={open}
        onOpenChange={setOpen}
      />
    </PanelFrame>
  );
}
