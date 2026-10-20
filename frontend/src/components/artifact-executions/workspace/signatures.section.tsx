"use client";

/**
 * Assinaturas.
 *
 * Os espaços vêm do Snapshot (`signatureSlots`), as coletas vêm da execução
 * (`signatures`). Cruzar os dois dá o estado de cada espaço:
 *
 * | Estado | Como se identifica |
 * | --- | --- |
 * | Realizada | há assinatura para o `slotId`, sem `revokedAt` |
 * | Revogada | há assinatura, com `revokedAt` |
 * | Pendente | não há assinatura e a execução aceita escrita |
 * | Bloqueada | não há assinatura e a execução não aceita escrita |
 *
 * "Bloqueada" não é uma regra inventada: reflete a mesma recusa que o servidor
 * já deu à execução (`ARTIFACT_EXECUTION_NOT_EDITABLE`) ou o fato de a conta
 * não ter permissão de execução.
 *
 * **O ato de assinar não é desta PR.** O endpoint existe
 * (`POST /:id/signatures`), exige `signatureData` e produz um hash SHA-256 no
 * servidor; coletar assinatura com validade jurídica é um módulo próprio.
 */
import { CircleDashed, Lock, PenLine, ShieldOff } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type { ArtifactExecution } from "@/types/artifact-executions";

type SlotState = "signed" | "revoked" | "pending" | "blocked";

const STATE_LABELS: Readonly<Record<SlotState, string>> = {
  signed: "Realizada",
  revoked: "Revogada",
  pending: "Pendente",
  blocked: "Bloqueada",
};

const STATE_CLASSES: Readonly<Record<SlotState, string>> = {
  signed: "bg-emerald-500/15 text-emerald-400",
  revoked: "bg-destructive/15 text-destructive",
  pending: "bg-amber-500/15 text-amber-400",
  blocked: "bg-surface-strong text-muted-foreground",
};

export function SignaturesSection({
  execution,
  writable,
}: {
  execution: ArtifactExecution;
  writable: boolean;
}) {
  const slots = [...execution.snapshot.signatureSlots].sort(
    (a, b) => a.order - b.order,
  );

  return (
    <PanelFrame
      panelId="artifact-execution-signatures"
      title="Assinaturas"
      description={`${execution.progressDetails.requiredSignatures - execution.progressDetails.pendingSignatures}/${execution.progressDetails.requiredSignatures} obrigatórias coletadas`}
    >
      {slots.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Este artefato não prevê assinaturas.
        </p>
      ) : (
        <ul className="space-y-2">
          {slots.map((slot) => {
            const signature = execution.signatures.find(
              (item) => item.slotId === slot.id,
            );
            const state: SlotState = signature
              ? signature.revokedAt
                ? "revoked"
                : "signed"
              : writable
                ? "pending"
                : "blocked";

            return (
              <li
                key={slot.id}
                className="space-y-1 rounded-lg border border-border px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StateIcon state={state} />
                  <span className="text-sm font-medium">{slot.label}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {slot.signerRole}
                  </Badge>
                  {slot.required ? (
                    <span className="text-xs text-destructive">
                      obrigatória
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "ml-auto rounded-md px-2 py-0.5 text-[10px] font-medium",
                      STATE_CLASSES[state],
                    )}
                  >
                    {STATE_LABELS[state]}
                  </span>
                </div>

                {signature ? (
                  <p className="text-xs text-muted-foreground">
                    {signature.signerName}
                    {signature.signerDocument
                      ? ` · ${signature.signerDocument}`
                      : ""}{" "}
                    · {formatDateTime(signature.signedAt)}
                    <span className="ml-1 font-mono">
                      {signature.signatureHash.slice(0, 12)}
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        A coleta de assinatura ainda não está disponível nesta tela.
      </p>
    </PanelFrame>
  );
}

function StateIcon({ state }: { state: SlotState }) {
  if (state === "signed") {
    return <PenLine className="size-4 text-emerald-400" aria-hidden />;
  }
  if (state === "revoked") {
    return <ShieldOff className="size-4 text-destructive" aria-hidden />;
  }
  if (state === "blocked") {
    return <Lock className="size-4 text-muted-foreground" aria-hidden />;
  }
  return <CircleDashed className="size-4 text-amber-400" aria-hidden />;
}
