"use client";

/**
 * Status da execução.
 *
 * **Sem máquina de estados local.** `ArtifactExecutionStateMachine` decide
 * quais transições valem, e `ArtifactExecutionService` ainda exige
 * `canComplete` para `UNDER_REVIEW` e `COMPLETED`. Reproduzir isso aqui daria
 * duas verdades que divergem no primeiro ajuste do servidor.
 *
 * O painel oferece os destinos possíveis — todos menos o atual — envia a
 * intenção e apresenta a recusa quando ela vem, com o código e a mensagem do
 * backend. É o mesmo desenho das ações de campo do aplicativo móvel.
 *
 * O que a interface acrescenta é contexto, não regra: quando o servidor já
 * disse que a execução não está pronta para encerrar (`canComplete: false`),
 * isso é exibido ao lado das ações — é informação vinda de lá, não um
 * julgamento feito aqui.
 */
import { ArrowRight } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelFrame } from "@/components/panels";
import { Button } from "@/components/ui/button";
import type {
  ArtifactExecution,
  ArtifactExecutionStatus,
} from "@/types/artifact-executions";
import { ARTIFACT_EXECUTION_STATUSES } from "@/types/artifact-executions";
import {
  ExecutionStatusBadge,
  executionStatusLabel,
} from "../execution-badges";

export function StatusSection({
  execution,
  canExecute,
  pending,
  pendingTarget,
  error,
  onChange,
}: {
  execution: ArtifactExecution;
  canExecute: boolean;
  pending: boolean;
  pendingTarget: ArtifactExecutionStatus | null;
  error: unknown;
  onChange: (status: ArtifactExecutionStatus) => void;
}) {
  const targets = ARTIFACT_EXECUTION_STATUSES.filter(
    (status) => status !== execution.status,
  );

  return (
    <PanelFrame
      panelId="artifact-execution-status"
      title="Status"
      description="As mudanças possíveis dependem da situação atual"
      actions={<ExecutionStatusBadge status={execution.status} />}
    >
      <div className="space-y-4">
        {canExecute ? (
          <>
            <div className="flex flex-wrap gap-2">
              {targets.map((status) => (
                <Button
                  key={status}
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => onChange(status)}
                >
                  <ArrowRight className="size-3.5" />
                  {pending && pendingTarget === status
                    ? "Enviando…"
                    : executionStatusLabel(status)}
                </Button>
              ))}
            </div>

            {execution.progressDetails.canComplete ? null : (
              <p className="text-xs text-muted-foreground">
                Ainda há campos obrigatórios ou assinaturas pendentes — transições que exigem execução completa
                serão recusadas.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sua conta não pode alterar o andamento desta execução.
          </p>
        )}

        <MutationError error={error} />
      </div>
    </PanelFrame>
  );
}
