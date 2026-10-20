"use client";

/**
 * Linha do tempo e histórico.
 *
 * São coisas diferentes, e o backend só tem uma delas.
 *
 * **Linha do tempo** é montada aqui a partir dos carimbos de tempo que a
 * própria execução devolve — `createdAt`, `startedAt`, `pausedAt`,
 * `submittedAt`, `approvedAt`, `completedAt`, `archivedAt`, mais as datas de
 * respostas, anexos, assinaturas e insights. Não há invenção: cada item é um
 * fato datado que veio no Read Model. Ordenar fatos recebidos é apresentação.
 *
 * **Histórico** — quem mudou o quê, com valor anterior e posterior — não tem
 * fonte. O repositório escreve `auditLog` a cada operação, mas nenhum
 * controller expõe leitura de auditoria, e execuções não têm tabela de
 * histórico como `OperationHistory`. O painel declara a ausência em vez de
 * fingir um histórico a partir da linha do tempo, que responderia "quando" mas
 * nunca "por quem".
 */
import { useMemo } from "react";
import {
  Archive,
  CircleCheck,
  FilePlus2,
  Lightbulb,
  Paperclip,
  PauseCircle,
  PenLine,
  PlayCircle,
  Send,
  ThumbsUp,
} from "lucide-react";

import { PanelFrame, PanelWithoutSource } from "@/components/panels";
import { formatDateTime } from "@/lib/formatters";
import type { ArtifactExecution } from "@/types/artifact-executions";

interface TimelineEntry {
  at: string;
  label: string;
  detail?: string;
  Icon: typeof PlayCircle;
}

export function TimelineSection({
  execution,
}: {
  execution: ArtifactExecution;
}) {
  const entries = useMemo(() => buildTimeline(execution), [execution]);

  return (
    <PanelFrame
      panelId="artifact-execution-timeline"
      title="Linha do tempo"
      description="Montada a partir das datas que a execução devolve"
    >
      {entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nada registrado ainda.
        </p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex gap-3">
              <entry.Icon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm">{entry.label}</p>
                {entry.detail ? (
                  <p className="text-xs text-muted-foreground">
                    {entry.detail}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </PanelFrame>
  );
}

export function HistorySection() {
  return (
    <PanelFrame
      panelId="artifact-execution-history"
      title="Histórico"
      description="Auditoria de quem alterou o quê"
    >
      <PanelWithoutSource reason="As alterações ficam registradas, mas o histórico de quem mudou o quê ainda não pode ser consultado aqui. A linha do tempo responde “quando”, não “por quem”." />
    </PanelFrame>
  );
}

/** Fatos datados da execução, do mais recente para o mais antigo. */
function buildTimeline(execution: ArtifactExecution): readonly TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const push = (
    at: string | null,
    label: string,
    Icon: TimelineEntry["Icon"],
    detail?: string,
  ) => {
    if (at) entries.push({ at, label, Icon, detail });
  };

  push(execution.createdAt, "Execução criada", FilePlus2);
  push(execution.startedAt, "Execução iniciada", PlayCircle);
  push(execution.pausedAt, "Execução pausada", PauseCircle);
  push(execution.submittedAt, "Enviada para revisão", Send);
  push(execution.approvedAt, "Aprovada", ThumbsUp);
  push(execution.completedAt, "Concluída", CircleCheck);
  push(execution.archivedAt, "Arquivada", Archive);

  for (const response of execution.responses) {
    push(
      response.updatedAt,
      "Resposta registrada",
      PenLine,
      `${response.sectionId} › ${response.fieldId} · ${response.provenance}`,
    );
  }
  for (const attachment of execution.attachments) {
    push(
      attachment.createdAt,
      "Anexo registrado",
      Paperclip,
      attachment.fileName,
    );
  }
  for (const signature of execution.signatures) {
    push(
      signature.signedAt,
      "Assinatura coletada",
      PenLine,
      `${signature.signerRole} · ${signature.signerName}`,
    );
    push(signature.revokedAt, "Assinatura revogada", PenLine, signature.slotId);
  }
  for (const insight of execution.insights) {
    push(insight.createdAt, insight.title, Lightbulb, insight.kind);
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
