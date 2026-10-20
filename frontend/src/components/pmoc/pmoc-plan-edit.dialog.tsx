"use client";

/**
 * Editar a configuração do plano.
 *
 * ## Só o que o backend aceita mudar
 *
 * `UpdatePmocPlanDto` é o `CreatePmocPlanDto` **menos** unidade, cliente e
 * código — os três são imutáveis por decisão de domínio: trocá-los
 * transformaria o plano em outro, com as execuções do anterior penduradas
 * nele. Eles aparecem como contexto, não como campo.
 *
 * O resto — nome, vigência, periodicidade, antecedência de aviso e
 * observações — é editável. Não deduzi isso do Read Model: veio do DTO.
 *
 * ## A recusa é do servidor
 *
 * Plano encerrado ou cancelado não pode ser editado, e o backend responde
 * `409` com a frase pronta. A tela mostra a recusa em vez de antecipá-la —
 * `EDITABLE_STATUSES` não é publicado em contrato nenhum, e replicar a lista
 * aqui criaria uma segunda verdade.
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
import { useUpdatePmocPlan } from "@/hooks/pmoc/use-pmoc";
import { PmocFrequencyUnit } from "@/types/contracts";
import type { PmocPlan } from "@/types/pmoc";

const FREQUENCY_LABELS: Readonly<Record<string, string>> = {
  DAYS: "dia(s)",
  WEEKS: "semana(s)",
  MONTHS: "mês(es)",
  YEARS: "ano(s)",
};

/** `YYYY-MM-DD` — o formato que o contrato aceita, e que o `input[date]` usa. */
const dateOnly = (value: string | null | undefined) =>
  value ? value.slice(0, 10) : "";

export function PmocPlanEditDialog({
  plan,
  open,
  onOpenChange,
}: {
  plan: PmocPlan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/**
         * O formulário só existe enquanto o diálogo está aberto.
         *
         * Reabrir remonta o componente, e os estados nascem do plano atual —
         * sem efeito para "resetar". Um rascunho abandonado reaparecendo como
         * se fosse o estado salvo é a pior forma de perder trabalho, porque
         * ninguém percebe.
         */}
        {open ? (
          <EditForm plan={plan} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ plan, onDone }: { plan: PmocPlan; onDone: () => void }) {
  const update = useUpdatePmocPlan(plan.id);

  const [name, setName] = useState(plan.name);
  const [startsOn, setStartsOn] = useState(dateOnly(plan.validity.startsOn));
  const [endsOn, setEndsOn] = useState(dateOnly(plan.validity.endsOn));
  const [amount, setAmount] = useState(String(plan.frequency.amount));
  const [unit, setUnit] = useState<string>(plan.frequency.unit);
  const [dueSoonDays, setDueSoonDays] = useState(
    String(plan.compliance.dueSoonDays),
  );
  const [notes, setNotes] = useState(plan.notes ?? "");

  const ready =
    name.trim().length > 0 && Number(amount) > 0 && Boolean(startsOn);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar {plan.code}</DialogTitle>
        <DialogDescription>
          Cliente, unidade e código não mudam: alterá-los transformaria este
          plano em outro, com o histórico do anterior.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="pmoc-edit-name">Nome</Label>
          <Input
            id="pmoc-edit-name"
            value={name}
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pmoc-edit-starts">Início da vigência</Label>
            <Input
              id="pmoc-edit-starts"
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmoc-edit-ends">Fim da vigência</Label>
            <Input
              id="pmoc-edit-ends"
              type="date"
              value={endsOn}
              onChange={(event) => setEndsOn(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="pmoc-edit-amount">Periodicidade</Label>
            <Input
              id="pmoc-edit-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmoc-edit-unit">Unidade</Label>
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger id="pmoc-edit-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(PmocFrequencyUnit).map((value) => (
                  <SelectItem key={value} value={value}>
                    {FREQUENCY_LABELS[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pmoc-edit-duesoon">Avisar com (dias)</Label>
            <Input
              id="pmoc-edit-duesoon"
              type="number"
              min={1}
              value={dueSoonDays}
              onChange={(event) => setDueSoonDays(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pmoc-edit-notes">Observações</Label>
          <Textarea
            id="pmoc-edit-notes"
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </div>

      <MutationError error={update.error} />

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button
          disabled={!ready || update.isPending}
          onClick={() =>
            update.mutate(
              {
                name: name.trim(),
                startsOn,
                ...(endsOn ? { endsOn } : {}),
                frequencyAmount: Number(amount),
                frequencyUnit: unit,
                dueSoonDays: Number(dueSoonDays),
                notes: notes.trim(),
              },
              { onSuccess: onDone },
            )
          }
        >
          {update.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </>
  );
}
