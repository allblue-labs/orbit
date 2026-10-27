"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { useUpload } from "@/hooks/api/use-transfer";
import { Button } from "@/components/ui/button";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { pmocService } from "@/services/pmoc.service";
import type { PmocExecutionPreparation } from "@/types/pmoc";

export function AttendanceEvidence({
  preparation,
  planId,
  cycleId,
  assetId,
  onBusy,
}: {
  preparation: PmocExecutionPreparation;
  planId: string;
  cycleId: string;
  assetId: string;
  onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const execution = preparation.existingExecution;
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useUpload<{ id: string }>(
    `/pmoc/equipment-executions/${execution?.id ?? ""}/evidence/upload`,
    {
      invalidate: [
        pmocService.keys.preparation(planId, cycleId, assetId),
        pmocService.keys.equipmentExecutions(planId, cycleId),
      ],
    },
  );
  const evidence = execution?.evidence ?? [];
  const limit = preparation.evidencePolicy.maximumPhotos;
  const allowed =
    preparation.allowedActions.includes("ADD_EVIDENCE") &&
    evidence.length < limit;
  async function send(file: File) {
    setProblem(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setProblem("Selecione uma imagem PNG, JPEG ou WebP.");
      return;
    }
    if (file.size > 10_000_000) {
      setProblem("A imagem deve ter até 10 MB.");
      return;
    }
    onBusy(true);
    try {
      await upload.upload(file);
    } catch {
      /* O hook apresenta a mensagem pública junto ao campo. */
    } finally {
      onBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          Evidências por imagem ({evidence.length}/{limit})
        </h4>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          aria-label="Selecionar imagem de evidência"
          disabled={!allowed || upload.isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void send(file);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!allowed || upload.isUploading}
          onClick={() => input.current?.click()}
        >
          {upload.isUploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {upload.isUploading ? "Enviando imagem…" : "Adicionar imagem"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Envie imagens do computador. PNG, JPEG ou WebP, até 10 MB por imagem.
      </p>
      {evidence.length ? (
        <ul className="space-y-2">
          {evidence.map((item) => (
            <li
              key={item.id}
              className="break-words rounded-lg bg-muted/40 p-3 text-sm"
            >
              {item.file.fileName}
              {item.caption ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.caption}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhuma imagem anexada.</p>
      )}
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <MutationError error={upload.error} />
    </section>
  );
}
