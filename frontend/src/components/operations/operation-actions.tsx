"use client";

/**
 * Ações do Owner sobre uma operação, direto da lista.
 *
 * Cada ação é uma chamada a um endpoint que já existia; nenhuma delas
 * reproduz regra:
 *
 * | Ação        | Endpoint                              |
 * | ----------- | ------------------------------------- |
 * | Editar      | `PATCH /operations/:id`               |
 * | Reagendar   | `PATCH /operations/:id` (janela)      |
 * | Prioridade  | `PATCH /operations/:id` (prioridade)  |
 * | Cancelar    | `PATCH /operations/:id/status`        |
 * | Excluir     | `DELETE /operations/:id`              |
 *
 * ## Transições
 *
 * O detalhe da operação publica `transitions` — a máquina de estados do
 * servidor, já resolvida para o status atual. É ela que preenche o seletor.
 *
 * Até a PR-FE-01 o menu oferecia **todos** os status do literal e deixava o
 * backend recusar. A intenção era não duplicar a máquina de estados, e estava
 * certa; o que faltava era usar a que o servidor publica. Oferecer destinos
 * inválidos não é neutralidade — é empurrar para o usuário a descoberta de uma
 * regra que o contrato já entrega pronta.
 *
 * A partir da listagem não há `transitions`: o Read Model de lista é compacto
 * de propósito. O seletor então **busca o detalhe** em vez de cair de volta no
 * enum completo.
 *
 * ## Permissões e ações permitidas
 *
 * Duas camadas, e as duas vêm do servidor:
 *
 * - a **sessão** diz o que a conta poderia fazer (`operations.update`,
 *   `operations.assign`, `operations.status.update`, `operations.delete`);
 * - o **registro** diz o que vale para esta linha, em `allowedActions`.
 *
 * A segunda é a que o navegador não teria como calcular: mudar status exige
 * participar da operação — ser o responsável ou um auxiliar — a menos que a
 * pessoa gerencie a carteira. Antes desta PR o menu ignorava `allowedActions`,
 * e um técnico não escalado via "Alterar status", clicava e recebia 403 sem
 * explicação.
 */
import { useState } from "react";
import {
  CalendarClock,
  MoreHorizontal,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  useChangeOperationStatus,
  useRemoveOperation,
  useOperation,
  useUpdateOperation,
} from "@/hooks/operations/use-operations";
import { instantFromZoned, zonedParts } from "@/lib/scheduling";
import { useSession } from "@/providers/session-provider";
import { actionAuthority, availableTransitions } from "@/registry";
import { OperationPriority } from "@/types/contracts";
import {
  OPERATION_LIMITS,
  OPERATION_STATUS_LABELS,
  type Operation,
  type OperationListItem,
} from "@/types/operations";
import { operationPriorityLabel } from "./operation-badges";

type ActionKind = "reschedule" | "priority" | "status" | "delete";

export function OperationActions({
  operation,
  timeZone,
  onEdit,
}: {
  /** Linha da listagem ou detalhe — ambos publicam `allowedActions`. */
  operation: OperationListItem;
  timeZone: string;
  onEdit: () => void;
}) {
  const session = useSession();
  const [action, setAction] = useState<ActionKind | null>(null);

  /** O que este registro permite, segundo o servidor. */
  const authority = actionAuthority(operation.allowedActions);

  /**
   * Sessão **e** registro.
   *
   * A sessão esconde o que a conta nunca poderia fazer; `allowedActions`
   * esconde o que não vale para esta linha. Excluir não está no contrato de
   * ações — segue apenas pela permissão, como antes.
   */
  const canUpdate =
    session.hasPermission("operations.update") && authority.permits("EDIT");
  const canChangeStatus =
    session.hasPermission("operations.status.update") &&
    authority.permits("CHANGE_STATUS");
  const canDelete = session.hasPermission("operations.delete");

  if (!canUpdate && !canChangeStatus && !canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Ações da operação ${operation.code}`}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="font-mono text-xs">
            {operation.code}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {canUpdate ? (
            <>
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="size-4" />
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAction("reschedule")}>
                <CalendarClock className="size-4" />
                Reagendar
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAction("priority")}>
                <MoreHorizontal className="size-4" />
                Alterar prioridade
              </DropdownMenuItem>
            </>
          ) : null}

          {canChangeStatus ? (
            <DropdownMenuItem onSelect={() => setAction("status")}>
              <XCircle className="size-4" />
              Alterar status
            </DropdownMenuItem>
          ) : null}

          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setAction("delete")}
              >
                <Trash2 className="size-4" />
                Excluir
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {action === "reschedule" ? (
            <RescheduleForm
              operation={operation}
              timeZone={timeZone}
              onClose={() => setAction(null)}
            />
          ) : null}
          {action === "priority" ? (
            <PriorityForm
              operation={operation}
              onClose={() => setAction(null)}
            />
          ) : null}
          {action === "status" ? (
            <StatusForm operation={operation} onClose={() => setAction(null)} />
          ) : null}
          {action === "delete" ? (
            <DeleteForm operation={operation} onClose={() => setAction(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Reagendar                                                           */
/* ------------------------------------------------------------------ */

function RescheduleForm({
  operation,
  timeZone,
  onClose,
}: {
  operation: OperationListItem;
  timeZone: string;
  onClose: () => void;
}) {
  const update = useUpdateOperation(operation.id);
  const [start, setStart] = useState(() =>
    toLocalInput(operation.scheduledStart, timeZone),
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Reagendar {operation.code}</DialogTitle>
        <DialogDescription>
          Quando o atendimento começa, no fuso {timeZone}. A operação não passa
          pelo motor de agenda — nenhuma sobreposição é avaliada.
        </DialogDescription>
      </DialogHeader>

      {/*
        Só o começo, como na criação.

        Pedir o fim aqui e não lá deixaria o produto incoerente consigo
        mesmo: o atendimento nasceria sem previsão de término e ganharia uma
        ao ser remarcado.
      */}
      <div className="space-y-2">
        <Label htmlFor="reschedule-start">Início</Label>
        <Input
          id="reschedule-start"
          type="datetime-local"
          value={start}
          onChange={(event) => setStart(event.target.value)}
        />
      </div>

      <MutationError error={update.error} />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              { scheduledStart: toInstant(start, timeZone) },
              { onSuccess: onClose },
            )
          }
        >
          {update.isPending ? "Salvando…" : "Reagendar"}
        </Button>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Prioridade                                                          */
/* ------------------------------------------------------------------ */

function PriorityForm({
  operation,
  onClose,
}: {
  operation: OperationListItem;
  onClose: () => void;
}) {
  const update = useUpdateOperation(operation.id);
  const [priority, setPriority] = useState<string>(operation.priority);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Prioridade de {operation.code}</DialogTitle>
        <DialogDescription>
          A prioridade não altera a ordem da listagem, que segue o agendamento e a data de criação.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="operation-priority-change">Prioridade</Label>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger id="operation-priority-change">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(OperationPriority).map((value) => (
              <SelectItem key={value} value={value}>
                {operationPriorityLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <MutationError error={update.error} />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          disabled={update.isPending || priority === operation.priority}
          onClick={() =>
            update.mutate(
              { priority: priority as Operation["priority"] },
              { onSuccess: onClose },
            )
          }
        >
          {update.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

function StatusForm({
  operation,
  onClose,
}: {
  operation: OperationListItem;
  onClose: () => void;
}) {
  const change = useChangeOperationStatus(operation.id);
  const [status, setStatus] = useState<string>(operation.status);
  const [reason, setReason] = useState("");

  /**
   * A máquina de estados vem do detalhe.
   *
   * Aberto a partir da listagem, o registro em mãos não tem `transitions` — e
   * a alternativa seria oferecer o enum inteiro, que é justamente o que esta
   * PR remove. Uma consulta ao detalhe custa menos que um destino inválido
   * oferecido ao usuário.
   */
  const detail = useOperation(operation.id);
  const transitions = availableTransitions(
    detail.data?.transitions,
    operation.status,
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Status de {operation.code}</DialogTitle>
        <DialogDescription>
          Apenas as mudanças possíveis a partir da situação atual são oferecidas.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="operation-status">Novo status</Label>
          <Select
            value={status === operation.status ? "" : status}
            onValueChange={setStatus}
            disabled={detail.isPending || transitions?.length === 0}
          >
            <SelectTrigger id="operation-status">
              <SelectValue
                placeholder={
                  detail.isPending
                    ? "Carregando destinos…"
                    : "Selecione o novo status"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {(transitions ?? []).map((value) => (
                <SelectItem key={value} value={value}>
                  {OPERATION_STATUS_LABELS[value] ?? value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {transitions?.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Este atendimento está em{" "}
              {OPERATION_STATUS_LABELS[operation.status] ?? operation.status} e
              não pode mais mudar de situação.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="operation-status-reason">Motivo</Label>
          <Textarea
            id="operation-status-reason"
            rows={2}
            value={reason}
            maxLength={OPERATION_LIMITS.statusReasonMaxLength}
            placeholder="Registrado no histórico da operação"
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>

      <MutationError error={change.error} />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          disabled={
            change.isPending ||
            detail.isPending ||
            status === operation.status ||
            !transitions?.includes(status as Operation["status"])
          }
          onClick={() =>
            change.mutate(
              {
                status: status as Operation["status"],
                reason: reason.trim() || undefined,
              },
              { onSuccess: onClose },
            )
          }
        >
          {change.isPending ? "Aplicando…" : "Aplicar"}
        </Button>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Exclusão                                                            */
/* ------------------------------------------------------------------ */

function DeleteForm({
  operation,
  onClose,
}: {
  operation: OperationListItem;
  onClose: () => void;
}) {
  const remove = useRemoveOperation();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Excluir {operation.code}?</DialogTitle>
        <DialogDescription>
          A exclusão remove o registro das listagens e preserva o histórico. Cancelar a operação, mudando o status,
          preserva o rastro na interface.
        </DialogDescription>
      </DialogHeader>

      <MutationError error={remove.error} />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Manter
        </Button>
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate(operation.id, { onSuccess: onClose })}
        >
          {remove.isPending ? "Excluindo…" : "Excluir"}
        </Button>
      </DialogFooter>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Datas                                                               */
/* ------------------------------------------------------------------ */

function toLocalInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function toInstant(local: string, timeZone: string): string | undefined {
  if (!local) return undefined;
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time ?? "00:00").split(":").map(Number);
  return instantFromZoned(
    { year, month, day, hour, minute },
    timeZone,
  ).toISOString();
}
