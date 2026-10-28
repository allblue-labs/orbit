"use client";

/**
 * Transferência entre unidades.
 *
 * ## Origem e destino, ditos antes de confirmar
 *
 * A tela mostra as duas pontas e a quantidade num resumo próprio, porque é a
 * operação em que errar de lado é mais fácil e mais caro: transferir para a
 * filial errada tira a peça de quem precisa dela hoje.
 *
 * ## Atômica, e sem trânsito
 *
 * O servidor grava as duas pontas na mesma transação. Não existe estado
 * "saiu de A e ainda não chegou em B" — e a tela não o simula: modelá-lo
 * exigiria um terceiro saldo e um aceite no destino, que o backend não tem.
 * O material sai e chega no mesmo instante.
 *
 * Depois do sucesso, **as duas projeções são revalidadas** pela invalidação do
 * hook — nenhum saldo é remendado localmente.
 */
import { useState } from "react";
import { ArrowRight } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useInventoryTransfer } from "@/hooks/inventory/use-inventory";
import { useActiveScope } from "@/providers/use-active-scope";
import type { InventoryItemRef } from "@/types/inventory";
import { Quantity } from "./inventory-presentation";

export function InventoryTransferDialog({
  item,
  fromBusinessUnitId,
  currentOnHand,
  open,
  onOpenChange,
}: {
  item: InventoryItemRef | { id: string; name: string; unit: string };
  fromBusinessUnitId?: string;
  currentOnHand?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <Body
          item={item}
          fromBusinessUnitId={fromBusinessUnitId}
          currentOnHand={currentOnHand}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  item,
  fromBusinessUnitId,
  currentOnHand,
  onOpenChange,
}: {
  item: InventoryItemRef | { id: string; name: string; unit: string };
  fromBusinessUnitId?: string;
  currentOnHand?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { businessUnits, businessUnitId } = useActiveScope();
  const transfer = useInventoryTransfer();

  const [from, setFrom] = useState(
    fromBusinessUnitId ?? businessUnitId ?? "",
  );
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const nameOf = (id: string) => {
    const unit = businessUnits.find((option) => option.id === id);
    return unit ? (unit.tradeName ?? unit.legalName) : "—";
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    transfer.mutate(
      {
        catalogItemId: item.id,
        fromBusinessUnitId: from,
        toBusinessUnitId: to,
        quantity: toNumber(quantity),
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const amount = toNumber(quantity);
  const incomplete =
    !from ||
    !to ||
    from === to ||
    !Number.isFinite(amount) ||
    amount <= 0;

  /**
   * Só há para onde transferir se houver mais de uma unidade.
   *
   * Com uma só, a operação não faz sentido — e dizer isso é melhor que
   * oferecer um seletor vazio.
   */
  if (businessUnits.length < 2) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Transferir entre unidades</DialogTitle>
          <DialogDescription>
            A organização tem uma unidade só. Transferência move material entre
            duas prateleiras diferentes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Entendi
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Transferir entre unidades</DialogTitle>
        <DialogDescription>
          Sai de uma unidade e entra na outra na mesma operação. Não há estado
          intermediário — o material chega no mesmo instante.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium">{item.name}</p>
          {currentOnHand !== undefined ? (
            <p className="text-xs text-muted-foreground">
              Em estoque na origem:{" "}
              <Quantity value={currentOnHand} unit={item.unit} />
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="transfer-from">Origem</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger id="transfer-from">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {businessUnits.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.tradeName ?? option.legalName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transfer-to">Destino</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger id="transfer-to">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {businessUnits
                  .filter((option) => option.id !== from)
                  .map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.tradeName ?? option.legalName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label required htmlFor="transfer-quantity">Quantidade ({item.unit})</Label>
          <Input
            id="transfer-quantity"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="0"
            required
          />
        </div>

        {/* O resumo: errar de lado aqui é fácil, e caro. */}
        {from && to && Number.isFinite(amount) && amount > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <span className="font-medium">{nameOf(from)}</span>
            <ArrowRight className="size-4 text-primary" aria-hidden />
            <span className="font-medium">{nameOf(to)}</span>
            <span className="ml-auto">
              <Quantity value={`${amount}`} unit={item.unit} />
            </span>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="transfer-reason">Motivo</Label>
          <Input
            id="transfer-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Ex.: reposição da filial"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="transfer-notes">Observações</Label>
          <Textarea
            id="transfer-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            rows={2}
          />
        </div>
      </div>

      <MutationError error={transfer.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || transfer.isPending}>
          {transfer.isPending ? "Transferindo…" : "Transferir"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function toNumber(value: string): number {
  return Number(value.trim().replace(/\./g, "").replace(",", "."));
}
