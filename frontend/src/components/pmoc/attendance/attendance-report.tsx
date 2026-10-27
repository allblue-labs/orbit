"use client";

import { useEffect } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  useExecutionManifests,
  useRenderState,
  useRequestRender,
} from "@/hooks/documents/use-documents";
import { useSignedUrl } from "@/hooks/documents/use-signed-url";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { browserUrlFor } from "@/lib/backend-url";

export function AttendanceReport({
  artifactId,
}: {
  artifactId: string | null;
}) {
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
  if (!artifactId) return null;
  return (
    <div className="space-y-3">
      {signed.data ? (
        <Button asChild>
          <a
            href={browserUrlFor(signed.data.url)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download className="size-4" />
            Baixar relatório de execução
          </a>
        </Button>
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
