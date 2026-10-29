"use client";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/api/client";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { OperationScheduleWarningReadModel } from "@/types/contracts/modules/operations/operation.read-models";
export interface ScheduleCheckInput {
  userIds: string[];
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  excludeOperationId?: string;
}
export function useScheduleConfirmation() {
  const [warnings, setWarnings] = useState<OperationScheduleWarningReadModel[]>(
    [],
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const action = useRef<(() => void) | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { formatDateTime } = useDateFormatters();
  const checkAndRun = async (input: ScheduleCheckInput, next: () => void) => {
    if (busy.current) return;
    setError(null);
    if (!input.scheduledStart || !input.userIds.length) {
      next();
      return;
    }
    busy.current = true;
    setChecking(true);
    try {
      const result = await apiClient.post<OperationScheduleWarningReadModel[]>(
        "/operations/schedule-check",
        {
          ...input,
          userIds: [...new Set(input.userIds)],
          scheduledEnd: input.scheduledEnd || undefined,
        },
      );
      if (!mounted.current) return;
      if (result.length) {
        action.current = next;
        setWarnings(result);
      } else next();
    } catch (reason) {
      setError(reason);
    } finally {
      busy.current = false;
      setChecking(false);
    }
  };
  const confirmation = (
    <>
      <MutationError error={error} />
      <ConfirmDialog
        open={warnings.length > 0}
        onOpenChange={(open) => {
          if (!open) {
            setWarnings([]);
            action.current = null;
          }
        }}
        title="Este técnico já tem um atendimento próximo"
        body="Há horários sobrepostos ou com intervalo de até 10 minutos para alguém da equipe. Confira a agenda e confirme se deseja continuar mesmo assim."
        confirmLabel="Confirmar e continuar"
        onConfirm={() => {
          const next = action.current;
          action.current = null;
          setWarnings([]);
          next?.();
        }}
      >
        <ul className="max-h-64 space-y-3 overflow-auto text-sm">
          {warnings.map((item, index) => (
            <li key={index} className="rounded-lg border border-border p-3">
              <p className="font-medium">{item.userName}</p>
              <p className="mt-1 break-words text-muted-foreground">
                {item.title}
              </p>
              <p className="mt-1 text-xs">
                {formatDateTime(item.startsAt)}
                {item.endsAt ? ` até ${formatDateTime(item.endsAt)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
  return { checkAndRun, checking, confirmation };
}
