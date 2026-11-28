"use client";

import { useState } from "react";
import {
  CalendarClock,
  Loader2,
  Pencil,
  UserRoundPlus,
  XCircle,
} from "lucide-react";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCancelPmocEquipmentSchedule,
  usePmocExecutionPreparation,
  useUpdatePmocEquipmentSchedule,
} from "@/hooks/pmoc/use-pmoc";
import { useScheduleConfirmation } from "@/hooks/operations/use-schedule-confirmation";
import { useTimeZone } from "@/hooks/use-timezone";
import { instantFromLocalInput, zonedParts } from "@/lib/scheduling/timezone";
import { notifySuccess } from "@/lib/notify";
import type { PmocCycleEquipmentRow } from "@/types/pmoc";

type Action = "edit" | "assign" | "cancel";

export function PmocEquipmentActions({
  planId,
  cycleId,
  row,
  onInteract,
}: {
  planId: string;
  cycleId: string;
  row: PmocCycleEquipmentRow;
  onInteract: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const actions = row.management?.allowedActions ?? [];
  const choose = (value: Action) => {
    onInteract();
    setAction(value);
  };
  if (!actions.length) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {actions.includes("ASSIGN") ? (
          <Button size="sm" variant="outline" onClick={() => choose("assign")}>
            <UserRoundPlus className="size-3.5" />
            {row.execution || row.schedule?.responsibleFieldTechnician
              ? "Alterar equipe"
              : "Atribuir técnico"}
          </Button>
        ) : null}
        {actions.includes("EDIT") ? (
          <Button size="sm" variant="ghost" onClick={() => choose("edit")}>
            <Pencil className="size-3.5" />
            Editar execução
          </Button>
        ) : null}
        {actions.includes("CANCEL") ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => choose("cancel")}
          >
            <XCircle className="size-3.5" />
            Cancelar execução
          </Button>
        ) : null}
      </div>
      {action ? (
        <EquipmentDialog
          key={action}
          planId={planId}
          cycleId={cycleId}
          row={row}
          action={action}
          onClose={() => setAction(null)}
        />
      ) : null}
    </>
  );
}

function EquipmentDialog({
  planId,
  cycleId,
  row,
  action,
  onClose,
}: {
  planId: string;
  cycleId: string;
  row: PmocCycleEquipmentRow;
  action: Action;
  onClose: () => void;
}) {
  const { timeZone } = useTimeZone();
  const preparation = usePmocExecutionPreparation(
    planId,
    action === "cancel" ? null : cycleId,
    row.equipment.id,
  );
  const update = useUpdatePmocEquipmentSchedule(
    planId,
    cycleId,
    row.equipment.id,
  );
  const cancel = useCancelPmocEquipmentSchedule(
    planId,
    cycleId,
    row.equipment.id,
  );
  const schedule = useScheduleConfirmation();
  // Freeze the original version with the form: a refetch must not authorize overwriting newer changes.
  const [version] = useState(row.management!.version);
  const [responsibleId, setResponsibleId] = useState(
    row.execution?.responsibleFieldTechnician.id ??
      row.schedule?.responsibleFieldTechnician?.id ??
      row.plannedFieldTechnician?.id ??
      "",
  );
  const [auxiliaryIds, setAuxiliaryIds] = useState<readonly string[]>(
    row.execution?.auxiliaryTechnicians.map((person) => person.id) ??
      row.schedule?.auxiliaryTechnicianIds ??
      [],
  );
  const [date, setDate] = useState(() => {
    if (!row.schedule?.scheduledFor) return "";
    const p = zonedParts(new Date(row.schedule.scheduledFor), timeZone);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
  });
  const [notes, setNotes] = useState(
    row.execution?.notes ?? row.schedule?.notes ?? "",
  );
  const [reason, setReason] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const pending = update.isPending || cancel.isPending || schedule.checking;
  const submit = async () => {
    setIssue(null);
    try {
      if (action === "cancel") {
        if (reason.trim().length < 3) {
          setIssue(
            "Informe o motivo do cancelamento com pelo menos 3 caracteres.",
          );
          return;
        }
        await cancel.mutateAsync({
          expectedVersion: version,
          reason: reason.trim(),
        });
        notifySuccess(
          "Execução cancelada",
          "O histórico foi preservado e as próximas manutenções continuam previstas.",
        );
        onClose();
        return;
      }
      if ((action === "assign" || row.execution) && !responsibleId) {
        setIssue("Selecione o técnico em campo para este atendimento.");
        return;
      }
      const scheduledFor = date
        ? instantFromLocalInput(date, timeZone).toISOString()
        : null;
      void schedule.checkAndRun(
        {
          userIds: [responsibleId, ...auxiliaryIds].filter(Boolean),
          scheduledStart: scheduledFor,
          excludeOperationId: row.execution?.operation?.id,
          excludePmocScheduleId: row.schedule?.id,
        },
        () => {
          void update
            .mutateAsync({
              expectedVersion: version,
              responsibleFieldTechnicianId: responsibleId || null,
              auxiliaryTechnicianIds: auxiliaryIds.filter(
                (id) => id !== responsibleId,
              ),
              scheduledFor,
              notes: notes.trim(),
            })
            .then(() => {
              notifySuccess(
                "Execução atualizada",
                "A equipe e a previsão foram salvas. O atendimento será iniciado pelo técnico ou pelo botão Atender.",
              );
              onClose();
            })
            .catch(() => {
              /* The mutation error remains inside the form. */
            });
        },
      );
    } catch {
      if (!cancel.error && action !== "cancel")
        setIssue("Confira os dados e o horário informado.");
    }
  };
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending) void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {action === "cancel"
                  ? "Cancelar execução do equipamento"
                  : action === "assign"
                    ? "Atribuir equipe ao equipamento"
                    : "Editar execução do equipamento"}
              </DialogTitle>
              <DialogDescription>
                {row.equipment.name}.{" "}
                {action === "cancel"
                  ? "O cancelamento vale somente para este equipamento neste período. Evidências e registros existentes serão preservados."
                  : "Planeje o atendimento sem iniciar a manutenção. Se a autorização estiver ativa, libere a demanda em Operações → Pendências para disponibilizá-la no mobile."}
              </DialogDescription>
            </DialogHeader>
            {action === "cancel" ? (
              <div className="space-y-2">
                <Label htmlFor="pmoc-cancellation-reason">
                  Motivo do cancelamento (obrigatório)
                </Label>
                <Textarea
                  id="pmoc-cancellation-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  disabled={pending}
                  aria-required
                />
              </div>
            ) : (
              <>
                {preparation.isPending ? (
                  <Skeleton className="h-32 w-full" />
                ) : preparation.error ? (
                  <div className="space-y-2">
                    <MutationError error={preparation.error} />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void preparation.refetch()}
                    >
                      Tentar novamente
                    </Button>
                  </div>
                ) : (
                  <fieldset disabled={pending} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="pmoc-schedule-technician">
                        Técnico em campo
                        {action === "assign" || row.execution
                          ? " (obrigatório)"
                          : " (opcional)"}
                      </Label>
                      <Select
                        value={responsibleId || "__none__"}
                        onValueChange={(id) => {
                          setResponsibleId(id === "__none__" ? "" : id);
                          setAuxiliaryIds((ids) =>
                            ids.filter((value) => value !== id),
                          );
                        }}
                      >
                        <SelectTrigger id="pmoc-schedule-technician">
                          <SelectValue placeholder="Selecione o técnico" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            Definir depois
                          </SelectItem>
                          {preparation.data?.fieldTechnicians.map((person) => (
                            <SelectItem key={person.id} value={person.id}>
                              {person.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!preparation.data?.fieldTechnicians.length ? (
                        <p className="text-xs text-muted-foreground">
                          Nenhum técnico em campo habilitado nesta unidade.
                          Confira o perfil profissional em Equipe.
                        </p>
                      ) : null}
                    </div>
                    {preparation.data?.auxiliaryTechnicians.length ? (
                      <div className="space-y-2">
                        <Label>Auxiliares técnicos (opcional)</Label>
                        <div className="grid gap-2 rounded-xl border border-border p-3">
                          {preparation.data.auxiliaryTechnicians
                            .filter((person) => person.id !== responsibleId)
                            .map((person) => (
                              <label
                                key={person.id}
                                className="flex items-center gap-3 text-sm"
                              >
                                <Checkbox
                                  checked={auxiliaryIds.includes(person.id)}
                                  onCheckedChange={(checked) =>
                                    setAuxiliaryIds((ids) =>
                                      checked === true
                                        ? [...ids, person.id]
                                        : ids.filter((id) => id !== person.id),
                                    )
                                  }
                                />
                                {person.name}
                              </label>
                            ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="space-y-2">
                      <Label
                        htmlFor="pmoc-schedule-date"
                        className="flex items-center gap-2"
                      >
                        <CalendarClock className="size-4" />
                        Data e hora previstas (opcional)
                      </Label>
                      <Input
                        id="pmoc-schedule-date"
                        type="datetime-local"
                        value={date}
                        onChange={(event) => setDate(event.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Fuso: {timeZone}. Sem horário definido, permanece o
                        vencimento do período.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pmoc-schedule-notes">
                        Orientações para o atendimento (opcional)
                      </Label>
                      <Textarea
                        id="pmoc-schedule-notes"
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        maxLength={1000}
                      />
                    </div>
                  </fieldset>
                )}
              </>
            )}
            {issue ? (
              <p role="alert" className="text-sm text-destructive">
                {issue}
              </p>
            ) : null}
            <MutationError error={update.error ?? cancel.error} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={onClose}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                variant={action === "cancel" ? "destructive" : "default"}
                disabled={pending || (action !== "cancel" && !preparation.data)}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {action === "cancel"
                  ? "Confirmar cancelamento"
                  : "Salvar execução"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {schedule.confirmation}
    </>
  );
}
