"use client";

/**
 * Status da operação.
 *
 * As transições válidas vêm no Read Model de detalhe. A mesma state machine
 * autoritativa valida o PATCH no backend; o cliente apenas apresenta a lista.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { PanelFrame, PanelState, type PanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorCopy } from "@/lib/error-copy";
import { useChangeOperationStatus } from "@/hooks/operations/use-operations";
import { useSession } from "@/providers/session-provider";
import { OPERATION_STATUS_LABELS, type Operation } from "@/types/operations";
import { OperationStatusBadge } from "../operation-badges";

/** Permissão exigida por `PATCH /operations/:id/status`. */
const STATUS_PERMISSION = "operations.status.update";

export function StatusSection({
  operationId,
  query,
}: {
  operationId: string;
  query: PanelQuery<Operation>;
}) {
  const session = useSession();
  const canChange = session.hasPermission(STATUS_PERMISSION);

  return (
    <PanelFrame
      panelId="operation-status"
      title="Status"
      description="Situação atual e mudança de estado"
      actions={
        query.data ? <OperationStatusBadge status={query.data.status} /> : null
      }
    >
      <PanelState query={query} loadingRows={2}>
        {(operation) =>
          canChange ? (
            <StatusForm operationId={operationId} operation={operation} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Sua conta não tem permissão para alterar o status desta operação.
            </p>
          )
        }
      </PanelState>
    </PanelFrame>
  );
}

function StatusForm({
  operationId,
  operation,
}: {
  operationId: string;
  operation: Operation;
}) {
  const [status, setStatus] = useState<string>(operation.status);
  const [reason, setReason] = useState("");
  const changeStatus = useChangeOperationStatus(operationId);
  const options = [operation.status, ...operation.transitions];

  const dirty = status !== operation.status;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await changeStatus.mutateAsync({
        status: status as Operation["status"],
        reason: reason.trim() || undefined,
      });
      setReason("");
      toast.success("Situação atualizada");
    } catch (error) {
      toast.error("Não foi possível alterar a situação", {
        description: errorCopy(error),
      });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="operation-status">Novo status</Label>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger id="operation-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem
                key={option}
                value={option}
                disabled={option === operation.status}
              >
                {OPERATION_STATUS_LABELS[option] ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="operation-status-reason">Motivo (opcional)</Label>
        <Textarea
          id="operation-status-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          rows={2}
          placeholder="Registrado no histórico da operação"
        />
      </div>

      <Button type="submit" disabled={!dirty || changeStatus.isPending}>
        {changeStatus.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : null}
        Alterar status
      </Button>
    </form>
  );
}
