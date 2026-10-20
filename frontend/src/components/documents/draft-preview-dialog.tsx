"use client";

/**
 * O rascunho do documento, antes de emitir.
 *
 * ## Por que o preview é o próprio PDF
 *
 * Desenhar uma aproximação em HTML criaria um segundo motor de layout, e a
 * pergunta que o preview existe para responder — "como isso vai sair
 * impresso?" — passaria a ter duas respostas que divergem. O backend devolve o
 * mesmo PDF que a emissão produziria, pelo mesmo renderer; o que muda é que
 * nada é persistido, versionado nem contado como revisão.
 *
 * ## O object URL é revogado
 *
 * Um `blob:` vive enquanto o documento da página viver. Sem revogar, cada
 * abertura deixaria um PDF inteiro retido na memória da aba — e quem revisa
 * abre o preview muitas vezes seguidas, que é justamente o uso previsto.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, Loader2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveRenderer } from "@/documents";
import { documentsService } from "@/services/documents.service";
import { toApiError } from "@/lib/api-error";

export function DraftPreviewDialog({
  executionId,
  renderer,
  disabled,
}: {
  executionId: string;
  renderer: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Guardado em ref para que a limpeza não dependa do ciclo de render. */
  const atual = useRef<string | null>(null);

  const descartar = useCallback(() => {
    if (atual.current) URL.revokeObjectURL(atual.current);
    atual.current = null;
    setUrl(null);
  }, []);

  useEffect(() => descartar, [descartar]);

  const abrir = useCallback(async () => {
    descartar();
    setError(null);
    setLoading(true);
    setOpen(true);
    try {
      const blob = await documentsService.previewDraft(executionId, renderer);
      const endereco = URL.createObjectURL(blob);
      atual.current = endereco;
      setUrl(endereco);
    } catch (falha) {
      setError(toApiError(falha));
    } finally {
      setLoading(false);
    }
  }, [descartar, executionId, renderer]);

  return (
    <>
      <Button variant="outline" disabled={disabled || loading} onClick={abrir}>
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Eye className="size-4" />
        )}
        {loading ? "Montando…" : "Pré-visualizar"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(aberto) => {
          setOpen(aberto);
          if (!aberto) descartar();
        }}
      >
        <DialogContent className="flex h-[90vh] max-w-5xl flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Pré-visualização</DialogTitle>
            <DialogDescription>
              {resolveRenderer(renderer).label} — rascunho a partir das
              respostas atuais. Nada é emitido nem versionado.
            </DialogDescription>
          </DialogHeader>

          <MutationError error={error} />

          {url ? (
            <>
              <iframe
                src={url}
                title="Pré-visualização do documento"
                className="min-h-0 flex-1 rounded-lg border border-border"
              />
              <div className="flex justify-end">
                {/* Escape para quem usa leitor de PDF externo ou quer imprimir
                    sem o cromo do diálogo. */}
                <Button variant="ghost" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    Abrir em nova aba
                  </a>
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {loading ? "Desenhando o documento…" : "Nada para mostrar."}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
