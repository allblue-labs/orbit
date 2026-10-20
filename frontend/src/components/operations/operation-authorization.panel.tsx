"use client";

/**
 * A autorização da atribuição, no atendimento.
 *
 * ## Só aparece onde a etapa existe
 *
 * A exigência é da organização inteira
 * (`settings.operations.requireAssignmentAuthorization`). Onde ela está
 * desligada, o carimbo é aplicado na própria atribuição e não há decisão a
 * tomar — mostrar um botão de autorizar ali inventaria um passo que aquela
 * operação não pratica.
 *
 * ## O que a liberação muda, dito sem rodeio
 *
 * Quem lê precisa saber a consequência antes de clicar: o atendimento entra
 * (ou sai) da fila do técnico no aplicativo. Um botão "Autorizar" sem isso
 * parece burocracia; com isso, é a ação que coloca alguém para trabalhar.
 */
import { ShieldCheck, ShieldQuestion } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { useSetOperationAuthorization } from "@/hooks/operations/use-operations";
import { useSession } from "@/providers/session-provider";
import type { Operation } from "@/types/operations";

const DATA_HORA = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

export function OperationAuthorizationPanel({
  operation,
  required,
}: {
  operation: Operation;
  /** A organização exige autorização depois da atribuição? */
  required: boolean;
}) {
  const session = useSession();
  const mutation = useSetOperationAuthorization(operation.id);
  const podeDecidir = session.hasPermission("operations.assign");

  if (!required) return null;

  const autorizado = operation.authorizedAt !== null;
  const semResponsavel = operation.responsibleFieldTechnician === null;

  return (
    <div
      className={
        autorizado
          ? "rounded-lg border border-success/40 bg-success/8 p-4"
          : "rounded-lg border border-warning/40 bg-warning/10 p-4"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            {autorizado ? (
              <ShieldCheck className="size-4 text-success" aria-hidden />
            ) : (
              <ShieldQuestion className="size-4 text-warning" aria-hidden />
            )}
            {autorizado
              ? "Atribuição autorizada"
              : "Aguardando autorização"}
          </p>
          <p className="text-xs text-muted-foreground">
            {autorizado
              ? `Liberado para o técnico${
                  operation.authorizedBy
                    ? ` por ${operation.authorizedBy.displayName}`
                    : ""
                }${
                  operation.authorizedAt
                    ? ` em ${DATA_HORA.format(new Date(operation.authorizedAt))}`
                    : ""
                }.`
              : "Este atendimento não aparece na fila do aplicativo até ser autorizado."}
          </p>
        </div>

        {podeDecidir ? (
          <Button
            size="sm"
            variant={autorizado ? "outline" : "default"}
            disabled={mutation.isPending || (!autorizado && semResponsavel)}
            onClick={() => mutation.mutate(!autorizado)}
          >
            {autorizado ? "Revogar autorização" : "Autorizar"}
          </Button>
        ) : null}
      </div>

      {/*
        Autorizar sem responsável não libera nada — a fila é pessoal, e sem
        alguém atribuído não há para quem o atendimento aparecer. Dizer isso é
        mais útil que um botão que parece funcionar e não muda nada.
      */}
      {!autorizado && semResponsavel ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Defina o responsável antes de autorizar: sem ele não há fila em que o
          atendimento possa entrar.
        </p>
      ) : null}

      {!podeDecidir ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Somente quem pode atribuir o atendimento pode autorizá-lo.
        </p>
      ) : null}

      <MutationError error={mutation.error} />
    </div>
  );
}
