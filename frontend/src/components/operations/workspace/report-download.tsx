"use client";

import { Download, Loader2 } from "lucide-react";
import { useAction } from "@/actions";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  useExecutionManifests,
  useRenderState,
} from "@/hooks/documents/use-documents";
import { useSignedUrl } from "@/hooks/documents/use-signed-url";
import { browserUrlFor } from "@/lib/backend-url";
import type { ArtifactExecutionListItem } from "@/types/artifact-executions";

/** Downloads the issued document of any type, including documents created in the app. */
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
  const revisions = useExecutionManifests(
    execution.id,
    access.allowed && status === "READY",
  );
  const manifest = revisions.data?.data.find(
    (item) =>
      item.isActive && item.status === "ISSUED" && Boolean(item.contentHash),
  );
  const signed = useSignedUrl(manifest?.id ?? "", "download", {
    enabled: access.allowed && Boolean(manifest),
  });

  if (!access.allowed)
    return (
      <p className="text-xs text-muted-foreground">{access.blockReason}</p>
    );
  const error =
    (pending ? render.error : null) ?? revisions.error ?? signed.error;
  if (error)
    return (
      <div className="space-y-2">
        <MutationError error={error} />
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (render.error) void render.refetch();
            else if (revisions.error) void revisions.refetch();
            else void signed.refetch();
          }}
        >
          Tentar baixar novamente
        </Button>
      </div>
    );
  if (signed.data)
    return (
      <Button size="sm" variant="outline" asChild>
        <a
          href={browserUrlFor(signed.data.url)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Baixar relatório: ${execution.title}`}
        >
          <Download className="size-4" />
          Baixar relatório
        </a>
      </Button>
    );
  if (
    status === "PENDING" ||
    status === "RENDERING" ||
    (status === "READY" &&
      (revisions.isPending || (manifest && signed.isPending)))
  ) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
        Preparando relatório…
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      {status === "READY"
        ? "Nenhuma revisão emitida está disponível para download."
        : status === "FAILED"
          ? "Não foi possível gerar este relatório. Abra o documento para verificar a emissão."
          : "O relatório ainda não foi gerado."}
    </p>
  );
}
