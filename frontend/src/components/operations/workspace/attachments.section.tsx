"use client";

/**
 * Anexos da operação.
 *
 * Upload, download e remoção usam os helpers da PR-01 (`upload`, `download`),
 * que passam pelo BFF — o arquivo nunca toca o NestJS diretamente e o token
 * continua no cookie `HttpOnly`.
 *
 * O limite de 20 MB é o do `FileInterceptor` no backend e é validado antes do
 * envio para não gastar upload até o 413.
 */
import { useRef, useState } from "react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { PanelFrame, PanelState, type PanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useUpload } from "@/hooks/api/use-transfer";
import { useRemoveOperationAttachment } from "@/hooks/operations/use-operations";
import { formatBytes } from "@/lib/formatters";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import { useSession } from "@/providers/session-provider";
import { operationsService } from "@/services/operations.service";
import { saveBlob } from "@/api/transfer";
import type { Operation, OperationAttachment } from "@/types/operations";

const CREATE_PERMISSION = "operations.attachments.create";
const DELETE_PERMISSION = "operations.attachments.delete";

export function AttachmentsSection({
  operationId,
  query,
}: {
  operationId: string;
  query: PanelQuery<Operation>;
}) {
  const { formatDateTime } = useDateFormatters();
  const session = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const canCreate = session.hasPermission(CREATE_PERMISSION);
  const canDelete = session.hasPermission(DELETE_PERMISSION);

  const uploader = useUpload<OperationAttachment>(
    `/operations/${encodeURIComponent(operationId)}/attachments`,
    { invalidate: [operationsService.keys.detail(operationId)] },
  );
  const removeAttachment = useRemoveOperationAttachment(operationId);

  async function handleFile(file: File) {
    try {
      await uploader.upload(file);
      toast.success("Anexo enviado");
    } catch (error) {
      toast.error("Não foi possível enviar o anexo", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDownload(attachment: OperationAttachment) {
    setDownloading(attachment.id);
    try {
      const result = await operationsService.downloadAttachment(
        operationId,
        attachment.id,
      );
      saveBlob(result, attachment.fileName);
    } catch (error) {
      toast.error("Não foi possível baixar o anexo", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDownloading(null);
    }
  }

  async function handleRemove(attachment: OperationAttachment) {
    try {
      await removeAttachment.mutateAsync(attachment.id);
      toast.success("Anexo removido");
    } catch (error) {
      toast.error("Não foi possível remover o anexo", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }

  return (
    <PanelFrame
      panelId="operation-attachments"
      title="Anexos"
      description="Arquivos vinculados à operação"
      actions={
        canCreate ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              aria-label="Selecionar arquivo"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={uploader.isUploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploader.isUploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Enviar
            </Button>
          </>
        ) : null
      }
    >
      <div className="space-y-4">
        {uploader.isUploading && uploader.progress ? (
          <div className="space-y-1.5">
            <Progress
              value={uploader.progress.percent}
              aria-label="Progresso do envio"
            />
            <p className="text-xs text-muted-foreground">
              Enviando… {uploader.progress.percent}%
            </p>
          </div>
        ) : null}

        <PanelState
          query={query}
          loadingRows={3}
          emptyMessage="Nenhum anexo enviado."
          isEmpty={(operation) => operation.attachments.length === 0}
        >
          {(operation) => (
            <ul className="space-y-2">
              {operation.attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="glass flex items-center justify-between gap-3 rounded-lg p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {attachment.fileName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(attachment.size)} ·{" "}
                        {formatDateTime(attachment.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant="outline" className="hidden sm:inline-flex">
                      {attachment.mimeType}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Baixar ${attachment.fileName}`}
                      disabled={downloading === attachment.id}
                      onClick={() => void handleDownload(attachment)}
                    >
                      {downloading === attachment.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Download className="size-4" />
                      )}
                    </Button>
                    {canDelete ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover ${attachment.fileName}`}
                        disabled={removeAttachment.isPending}
                        onClick={() => void handleRemove(attachment)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelState>
      </div>
    </PanelFrame>
  );
}
