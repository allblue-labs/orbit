"use client";

/**
 * Estoque mínimo do par item + unidade.
 *
 * **Não é movimento e não altera saldo.** É política de reposição: a partir de
 * quanto o item passa a aparecer como baixo. Zero desliga o alerta.
 *
 * O status continua vindo do servidor depois de salvar — a tela não recalcula
 * `LOW` comparando o novo mínimo com o saldo em memória.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInventoryMinimum } from "@/hooks/inventory/use-inventory";
import type { InventoryBalance } from "@/types/inventory";
import { Quantity } from "./inventory-presentation";

export function InventoryMinimumDialog({
  balance,
  open,
  onOpenChange,
}: {
  balance: InventoryBalance | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open && balance !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {balance ? (
          <Body
            key={balance.id}
            balance={balance}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  balance,
  onDone,
}: {
  balance: InventoryBalance;
  onDone: () => void;
}) {
  const minimum = useInventoryMinimum();
  const [value, setValue] = useState(balance.minimumStock);

  const amount = Number(value.trim().replace(/\./g, "").replace(",", "."));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        minimum.mutate(
          {
            catalogItemId: balance.item.id,
            businessUnitId: balance.businessUnit.id,
            minimumStock: amount,
          },
          { onSuccess: onDone },
        );
      }}
      className="space-y-5"
    >
      <DialogHeader>
        <DialogTitle>Estoque mínimo</DialogTitle>
        <DialogDescription>
          {balance.item.name} · {balance.businessUnit.name}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
          Em estoque agora:{" "}
          <Quantity value={balance.onHand} unit={balance.item.unit} />. Definir
          o mínimo <strong className="text-foreground">não move o saldo</strong>
          — é a régua que faz o item aparecer como baixo.
        </p>

        <div className="space-y-2">
          <Label required htmlFor="inventory-minimum">
            Mínimo ({balance.item.unit})
          </Label>
          <Input
            id="inventory-minimum"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            Zero desliga o alerta deste item nesta unidade.
          </p>
        </div>
      </div>

      <MutationError error={minimum.error} />

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={!Number.isFinite(amount) || amount < 0 || minimum.isPending}
        >
          {minimum.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
