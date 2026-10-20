"use client";

/**
 * Progresso — **inteiramente** do backend.
 *
 * `ArtifactExecutionProgressCalculator` conta campos visíveis, obrigatórios
 * pendentes, seções completas e assinaturas exigidas, e decide `canComplete`.
 * O painel apresenta esses números; não soma, não divide, não infere.
 *
 * Vale a pena olhar `canComplete`: é a resposta do servidor à pergunta "dá
 * para encerrar?". O painel de status a usa para explicar por que uma
 * transição pode ser recusada — sem replicar o critério que produziu a
 * resposta.
 */
import { CircleCheck, CircleDashed } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { ArtifactExecutionProgress } from "@/types/artifact-executions";

export function ProgressSection({
  progress,
}: {
  progress: ArtifactExecutionProgress;
}) {
  return (
    <PanelFrame
      panelId="artifact-execution-progress"
      title="Progresso"
      description="Atualizado a cada resposta e assinatura"
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="font-display text-3xl font-bold tabular-nums">
              {progress.percentage}%
            </span>
            <CompletionMark canComplete={progress.canComplete} />
          </div>
          <Progress value={progress.percentage} className="h-2" />
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Counter
            label="Campos respondidos"
            value={`${progress.answeredFields}/${progress.totalFields}`}
          />
          <Counter
            label="Seções completas"
            value={`${progress.completedSections}/${progress.totalSections}`}
          />
          <Counter
            label="Obrigatórios pendentes"
            value={progress.requiredPending}
            alert={progress.requiredPending > 0}
          />
          <Counter
            label="Assinaturas pendentes"
            value={`${progress.pendingSignatures}/${progress.requiredSignatures}`}
            alert={progress.pendingSignatures > 0}
          />
        </dl>
      </div>
    </PanelFrame>
  );
}

function CompletionMark({ canComplete }: { canComplete: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs",
        canComplete ? "text-emerald-400" : "text-muted-foreground",
      )}
    >
      {canComplete ? (
        <CircleCheck className="size-3.5" aria-hidden />
      ) : (
        <CircleDashed className="size-3.5" aria-hidden />
      )}
      {canComplete ? "Pronta para encerrar" : "Ainda há pendências"}
    </span>
  );
}

function Counter({
  label,
  value,
  alert,
}: {
  label: string;
  value: string | number;
  alert?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 font-medium tabular-nums",
          alert && "text-amber-400",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
