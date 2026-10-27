"use client";

/**
 * Registrar um movimento de estoque.
 *
 * ## A quantidade é sempre positiva
 *
 * O formulário nunca inverte sinal. Quem decide a direção é o **tipo**, e o
 * tipo é escolhido pela rota que o diálogo chama — entrada, consumo,
 * devolução, ajuste. Um campo que aceitasse negativo permitiria registrar
 * saída como entrada de sinal trocado, e a soma do livro passaria a depender
 * de como cada linha foi digitada.
 *
 * ## Não existe "novo saldo"
 *
 * Nem no ajuste. Informa-se **quanto** sobrou ou faltou na contagem; o saldo é
 * o que o servidor calcula depois. Um campo "saldo passa a ser X" transformaria
 * o ledger em decoração.
 *
 * ## Sem antecipação
 *
 * O saldo só muda na tela depois da resposta. O 409 por saldo insuficiente é
 * um caso real — outra pessoa deu baixa no intervalo — e a mensagem aparece
 * com o disponível que o servidor informou.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useInventoryAdjust,
  useInventoryConsume,
  useInventoryEntry,
  useInventoryReturn,
} from "@/hooks/inventory/use-inventory";
import { useActiveScope } from "@/providers/use-active-scope";
import {
  INVENTORY_TYPE_DESCRIPTIONS,
  INVENTORY_TYPE_LABELS,
  type InventoryItemRef,
} from "@/types/inventory";
import { AdjustmentNotice, Quantity } from "./inventory-presentation";

/** As quatro operações que este diálogo cobre. Transferência tem a sua. */
export type MovementKind =
  | "ENTRY"
  | "CONSUMPTION"
  | "RETURN"
  | "ADJUSTMENT_IN"
  | "ADJUSTMENT_OUT";

export function InventoryMovementDialog({
  kind,
  item,
  businessUnitId,
  /** Saldo atual da unidade, quando conhecido — só para contexto. */
  currentOnHand,
  operationId,
  open,
  onOpenChange,
}: {
  kind: MovementKind;
  item: InventoryItemRef | { id: string; name: string; unit: string };
  businessUnitId?: string;
  currentOnHand?: string;
  operationId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <Body
          key={kind}
          kind={kind}
          item={item}
          businessUnitId={businessUnitId}
          currentOnHand={currentOnHand}
          operationId={operationId}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  kind,
  item,
  businessUnitId,
  currentOnHand,
  operationId,
  onOpenChange,
}: {
  kind: MovementKind;
  item: InventoryItemRef | { id: string; name: string; unit: string };
  businessUnitId?: string;
  currentOnHand?: string;
  operationId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { businessUnits, businessUnitId: activeUnit } = useActiveScope();

  const entry = useInventoryEntry();
  const consume = useInventoryConsume();
  const giveBack = useInventoryReturn();
  const adjust = useInventoryAdjust();

  const mutation =
    kind === "ENTRY"
      ? entry
      : kind === "CONSUMPTION"
        ? consume
        : kind === "RETURN"
          ? giveBack
          : adjust;

  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [unit, setUnit] = useState(businessUnitId ?? activeUnit ?? "");

  const isAdjustment =
    kind === "ADJUSTMENT_IN" || kind === "ADJUSTMENT_OUT";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const amount = toNumber(quantity);
    const done = () => onOpenChange(false);
    const base = {
      catalogItemId: item.id,
      businessUnitId: unit || undefined,
      quantity: amount,
      notes: notes.trim() || undefined,
    };

    if (isAdjustment) {
      adjust.mutate(
        {
          ...base,
          direction: kind === "ADJUSTMENT_IN" ? "IN" : "OUT",
          reason: reason.trim(),
        },
        { onSuccess: done },
      );
      return;
    }

    const withReason = { ...base, reason: reason.trim() || undefined };
    if (kind === "ENTRY") {
      entry.mutate(withReason, { onSuccess: done });
      return;
    }
    if (kind === "CONSUMPTION") {
      consume.mutate({ ...withReason, operationId }, { onSuccess: done });
      return;
    }
    giveBack.mutate({ ...withReason, operationId }, { onSuccess: done });
  };

  const amount = toNumber(quantity);
  const incomplete =
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !unit ||
    (isAdjustment && reason.trim().length < 3);

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{INVENTORY_TYPE_LABELS[kind] ?? "Movimento"}</DialogTitle>
        <DialogDescription>
          {INVENTORY_TYPE_DESCRIPTIONS[kind]} A quantidade é sempre positiva —
          a direção é do tipo de movimento.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium">{item.name}</p>
          {currentOnHand !== undefined ? (
            <p className="text-xs text-muted-foreground">
              Em estoque agora:{" "}
              <Quantity value={currentOnHand} unit={item.unit} />
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label required htmlFor="inventory-quantity">
              Quantidade ({item.unit})
            </Label>
            <Input
              id="inventory-quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="0"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inventory-unit">Unidade</Label>
            <Select
              value={unit}
              onValueChange={setUnit}
              disabled={Boolean(businessUnitId)}
            >
              <SelectTrigger id="inventory-unit">
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
        </div>

        {isAdjustment ? <AdjustmentNotice /> : null}

        <div className="space-y-2">
          <Label required={isAdjustment} htmlFor="inventory-reason">
            Motivo{isAdjustment ? "" : " (opcional)"}
          </Label>
          <Input
            id="inventory-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder={
              isAdjustment
                ? "Ex.: contagem de inventário — duas unidades danificadas"
                : "Ex.: nota fiscal 12345"
            }
            required={isAdjustment}
          />
          {isAdjustment ? (
            <p className="text-xs text-muted-foreground">
              Obrigatório. Uma diferença sem explicação é a que ninguém
              justifica depois.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="inventory-notes">Observações</Label>
          <Textarea
            id="inventory-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            rows={2}
          />
        </div>
      </div>

      {/*
        A recusa por saldo insuficiente chega como 409 com o disponível na
        mensagem — e a invalidação do hook já revalidou o saldo exibido atrás
        deste diálogo.
      */}
      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || mutation.isPending}>
          {mutation.isPending ? "Registrando…" : "Registrar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Texto → número, só na fronteira com a API. Vírgula é como se digita aqui. */
function toNumber(value: string): number {
  return Number(value.trim().replace(/\./g, "").replace(",", "."));
}
