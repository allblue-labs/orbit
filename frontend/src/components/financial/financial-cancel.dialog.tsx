"use client";

/**
 * Cancelamento de lançamento.
 *
 * Diálogo próprio, e não um `confirm` genérico, por um motivo de contrato: o
 * backend **exige** `reason` com no mínimo três caracteres. Um botão que
 * apenas pergunta "tem certeza?" mandaria uma requisição que voltaria 400 —
 * e o texto do Action Registry já diz o que acontece; o que falta é o campo.
 *
 * ## Cancelar não apaga
 *
 * O lançamento permanece com motivo, autor e data. É por isso que o motivo é
 * obrigatório: um valor que sumiu do caixa sem explicação é a pergunta que
 * ninguém responde três meses depois.
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/actions";
import { useCancelFinancialEntry } from "@/hooks/financial/use-financial";
import type { FinancialEntry } from "@/types/financial";
import { Money } from "./financial-presentation";

export function FinancialCancelDialog({
  entry,
  onOpenChange,
}: {
  entry: FinancialEntry | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {entry ? (
          <Body key={entry.id} entry={entry} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  entry,
  onDone,
}: {
  entry: FinancialEntry;
  onDone: () => void;
}) {
  const action = useAction("financial-entry.cancel");
  const cancel = useCancelFinancialEntry();
  const [reason, setReason] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    cancel.mutate(
      { id: entry.id, input: { reason: reason.trim() } },
      { onSuccess: onDone },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {action.confirm?.title ?? "Cancelar este lançamento?"}
        </DialogTitle>
        <DialogDescription>
          {action.confirm?.body ??
            "Ele deixa de contar no saldo, mas continua na base."}
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-lg border border-border px-3 py-2 text-sm">
        <p className="font-medium">{entry.description}</p>
        <p className="text-muted-foreground">
          <Money value={entry.amount} type={entry.type} signed /> ·{" "}
          {entry.businessUnit.name}
        </p>
      </div>

      <div className="space-y-2">
        <Label required htmlFor="financial-cancel-reason">Motivo</Label>
        <Textarea
          id="financial-cancel-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Ex.: pagamento estornado pelo banco"
          required
        />
        <p className="text-xs text-muted-foreground">
          Obrigatório. Fica registrado junto com quem cancelou e quando.
        </p>
      </div>

      <MutationError error={cancel.error} />

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Voltar
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={reason.trim().length < 3 || cancel.isPending}
        >
          {cancel.isPending
            ? "Cancelando…"
            : (action.confirm?.confirmLabel ?? "Cancelar lançamento")}
        </Button>
      </DialogFooter>
    </form>
  );
}
