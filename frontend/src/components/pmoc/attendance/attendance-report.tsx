"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import {
  useExecutionManifests,
  useRenderState,
  useRequestRender,
} from "@/hooks/documents/use-documents";
import { useSignedUrl } from "@/hooks/documents/use-signed-url";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { saveBlob } from "@/api/transfer";
import { notifyError, notifyInfo } from "@/lib/notify";
import { browserUrlFor } from "@/lib/backend-url";

export function AttendanceReport({
  artifactId,
}: {
  artifactId: string | null;
}) {
  const [sharing, setSharing] = useState(false);
  const render = useRenderState(artifactId ?? "", Boolean(artifactId));
  const revisions = useExecutionManifests(
    artifactId ?? "",
    Boolean(artifactId),
  );
  const retry = useRequestRender(artifactId ?? "");
  const { refetch } = revisions;
  const status = render.data?.renderStatus;
  useEffect(() => {
    if (status === "READY") void refetch();
  }, [status, refetch]);
  const manifest = revisions.data?.data.find(
    (item) => item.isActive && item.status === "ISSUED",
  );
  const signed = useSignedUrl(manifest?.id ?? "", "download");
  const share = async () => {
    if (!signed.data || !manifest || sharing) return;
    setSharing(true);
    try {
      // Share the actual file: LOCAL storage URLs go through the authenticated
      // BFF and cannot be sent to a customer as a public download link.
      const response = await fetch(browserUrlFor(signed.data.url));
      if (!response.ok) throw new Error("Report download failed");
      const blob = await response.blob();
      const fileName = `relatorio-execucao-pmoc.${manifest.format.toLowerCase()}`;
      const file = new File([blob], fileName, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Relatório de execução do PMOC",
          files: [file],
        });
      } else {
        saveBlob({ blob, fileName, contentType: blob.type, sha256: null });
        notifyInfo(
          "Relatório baixado para compartilhar",
          "Este navegador não permite compartilhar arquivos diretamente. Envie o arquivo baixado pelo canal de sua preferência.",
        );
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        notifyError(
          "Não foi possível compartilhar o relatório",
          "Tente novamente ou use a opção de baixar.",
        );
      }
    } finally {
      setSharing(false);
    }
  };
  if (!artifactId) return null;
  return (
    <div className="space-y-3">
      {signed.data ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a
              href={browserUrlFor(signed.data.url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download className="size-4" />
              Baixar relatório de execução
            </a>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={sharing}
            onClick={() => void share()}
          >
            {sharing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Share2 className="size-4" />
            )}
            Compartilhar relatório
          </Button>
        </div>
      ) : status === "FAILED" || status === "NOT_RENDERED" ? (
        <Button
          type="button"
          variant="outline"
          disabled={retry.isPending}
          onClick={() => retry.mutate({})}
        >
          Emitir relatório novamente
        </Button>
      ) : (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" />
          Preparando o relatório para download…
        </p>
      )}
      <MutationError
        error={render.error ?? revisions.error ?? signed.error ?? retry.error}
      />
    </div>
  );
}
