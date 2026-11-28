"use client";

import { Loader2 } from "lucide-react";
import { useAction } from "@/actions";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { IssuedDocumentActions } from "@/documents/issued-document-actions";
import { isDocumentIssued } from "@/documents/issued-document";
import { useRenderState } from "@/hooks/documents/use-documents";
import type { ArtifactExecutionListItem } from "@/types/artifact-executions";

/**
 * Baixar ou compartilhar o documento emitido da operação — de qualquer tipo,
 * inclusive os gerados pelo app.
 *
 * Emitido, delega ao `IssuedDocumentActions`: o mesmo par de botões de toda
 * lista de documentos, e que só busca o arquivo no clique. Antes buscava a URL
 * assinada ao abrir a página — e ela expira, então o link podia estar vencido
 * quando a pessoa clicasse. Em emissão, acompanha o estado até ficar pronto.
 */
export function OperationReportDownload({
  execution,
}: {
  execution: ArtifactExecutionListItem;
}) {
  const access = useAction("artifact-execution.download-document");
  const pending =
    execution.renderStatus === "PENDING" ||
    execution.renderStatus === "RENDERING";
  const render = useRenderState(execution.id, access.allowed && pending);
  const status = pending
    ? (render.data?.renderStatus ?? execution.renderStatus)
    : execution.renderStatus;

  if (!access.allowed)
    return (
      <p className="text-xs text-muted-foreground">{access.blockReason}</p>
    );
  if (pending && render.error)
    return (
      <div className="space-y-2">
        <MutationError error={render.error} />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void render.refetch()}
        >
          Verificar novamente
        </Button>
      </div>
    );
  if (isDocumentIssued(status))
    return (
      <IssuedDocumentActions
        executionId={execution.id}
        renderStatus={status}
        code={execution.code}
        title={execution.title}
        variant="full"
      />
    );
  if (status === "PENDING" || status === "RENDERING")
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
        Preparando relatório…
      </p>
    );
  return (
    <p className="text-xs text-muted-foreground">
      {status === "FAILED"
        ? "Não foi possível gerar este relatório. Abra o documento para verificar a emissão."
        : "O relatório ainda não foi gerado."}
    </p>
  );
}
