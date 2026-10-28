"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OperationAddressField } from "@/components/operations/operation-address.field";
import { TechnicianAssignment } from "@/components/operations/technician-assignment";
import { useScheduleConfirmation } from "@/hooks/operations/use-schedule-confirmation";
import { operationInstant } from "@/components/operations/operation-wizard.model";
import { useTimeZone } from "@/hooks/use-timezone";
import {
  OPERATION_KIND_LABELS,
  type Quote,
  type ConvertQuoteInput,
} from "@/types/quotes";
export function QuoteConvertDialog({
  quote,
  open,
  onOpenChange,
  isPending,
  onConfirm,
  mutationError,
}: {
  quote: Quote;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onConfirm: (input: ConvertQuoteInput) => void;
  mutationError?: unknown;
}) {
  const { timeZone } = useTimeZone();
  const [form, setForm] = useState({
    kind: "MAINTENANCE",
    priority: "NORMAL",
    start: "",
    end: "",
    responsibleId: "",
    auxiliaryIds: [] as string[],
    addressId: quote.serviceAddress?.id ?? "",
    sector: "",
  });
  const edit = (patch: Partial<typeof form>) =>
    setForm((current) => ({ ...current, ...patch }));
  const [error, setError] = useState<string | null>(null);
  const schedule = useScheduleConfirmation();
  const pending = isPending || schedule.checking;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            setError(null);
            try {
              const scheduledStart = operationInstant(form.start, timeZone),
                scheduledEnd = operationInstant(form.end, timeZone);
              if (
                scheduledEnd &&
                (!scheduledStart || scheduledEnd <= scheduledStart)
              ) {
                setError(
                  "Informe um início previsto e um término posterior ao início.",
                );
                return;
              }
              const input: ConvertQuoteInput = {
                kind: form.kind,
                priority: form.priority,
                scheduledStart,
                scheduledEnd,
                responsibleFieldTechnicianId: form.responsibleId || undefined,
                auxiliaryTechnicianIds: form.auxiliaryIds,
                customerAddressId: form.addressId || undefined,
                sector: form.sector.trim() || undefined,
              };
              void schedule.checkAndRun(
                {
                  userIds: [form.responsibleId, ...form.auxiliaryIds].filter(
                    Boolean,
                  ),
                  scheduledStart,
                  scheduledEnd,
                },
                () => onConfirm(input),
              );
            } catch {
              setError("Confira a data e a hora do atendimento.");
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Converter orçamento em operação</DialogTitle>
            <DialogDescription>
              Prepare o atendimento de {quote.code} para{" "}
              {quote.customer.displayName}. Os equipamentos e o valor aprovado
              serão mantidos.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-5" disabled={pending}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quote-convert-kind">Tipo de serviço</Label>
                <Select
                  value={form.kind}
                  onValueChange={(kind) => edit({ kind })}
                >
                  <SelectTrigger id="quote-convert-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(OPERATION_KIND_LABELS).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-convert-priority">Prioridade</Label>
                <Select
                  value={form.priority}
                  onValueChange={(priority) => edit({ priority })}
                >
                  <SelectTrigger id="quote-convert-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries({
                      LOW: "Baixa",
                      NORMAL: "Normal",
                      HIGH: "Alta",
                      URGENT: "Urgente",
                    }).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <section className="space-y-4 rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold">Local do atendimento</h3>
              <OperationAddressField
                customerId={quote.customer.id}
                value={form.addressId}
                onChange={(addressId) => edit({ addressId })}
              />
              <div className="space-y-2">
                <Label htmlFor="quote-convert-sector">Setor (opcional)</Label>
                <Input
                  id="quote-convert-sector"
                  maxLength={120}
                  value={form.sector}
                  onChange={(event) => edit({ sector: event.target.value })}
                />
              </div>
            </section>
            <section className="space-y-4 rounded-xl border border-border p-4">
              <h3 className="text-sm font-semibold">Agenda e equipe</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label
                    htmlFor="quote-convert-start"
                    required={Boolean(form.end)}
                  >
                    Início previsto
                  </Label>
                  <Input
                    id="quote-convert-start"
                    type="datetime-local"
                    required={Boolean(form.end)}
                    value={form.start}
                    onChange={(event) => edit({ start: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="quote-convert-end">Término previsto</Label>
                  <Input
                    id="quote-convert-end"
                    type="datetime-local"
                    min={form.start || undefined}
                    value={form.end}
                    onChange={(event) => edit({ end: event.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Previsão opcional. Horários no fuso {timeZone}.
              </p>
              <TechnicianAssignment
                businessUnitId={quote.businessUnit.id}
                responsibleId={form.responsibleId}
                auxiliaryIds={form.auxiliaryIds}
                onChange={edit}
              />
            </section>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <MutationError error={mutationError} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Voltar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Preparando atendimento…" : "Criar operação"}
            </Button>
          </DialogFooter>
        </form>
        {schedule.confirmation}
      </DialogContent>
    </Dialog>
  );
}
