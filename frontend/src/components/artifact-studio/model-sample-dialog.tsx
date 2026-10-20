"use client";

/**
 * O exemplo do modelo, para escolher vendo em vez de imaginando.
 *
 * ## Por que o PDF de verdade
 *
 * A pergunta que a tela responde é "como este documento sai". Desenhar uma
 * aproximação em HTML criaria um segundo motor de layout, e a resposta passaria
 * a ter duas versões que divergem — a que se vê aqui e a que o cliente recebe.
 * O backend devolve o mesmo PDF que a emissão produziria, pelo mesmo
 * renderizador; o que muda é o conteúdo, fictício, e o fato de nada ser gravado.
 *
 * ## O timbre é o da organização
 *
 * Os dados do exemplo são inventados — cliente, equipamentos, respostas —, mas o
 * cabeçalho é o real, com a logo que a organização subiu. É a parte que quem
 * escolhe um modelo quer conferir, e a única que não faria sentido inventar.
 *
 * ## O object URL é revogado
 *
 * Um `blob:` vive enquanto o documento da página viver. Sem revogar, cada
 * abertura deixaria um PDF inteiro retido na memória da aba — e escolher modelo
 * é abrir vários seguidos.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Eye, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { documentsService } from "@/services/documents.service";
import { toApiError } from "@/lib/api-error";
import { MutationError } from "./mutation-error";

export function ModelSampleDialog({
  artifactType,
  modelName,
  variant = "outline",
}: {
  artifactType: string;
  modelName: string;
  variant?: "outline" | "ghost" | "default";
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Em ref para que a limpeza não dependa do ciclo de render. */
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
      const blob = await documentsService.sampleDocument(artifactType);
      const endereco = URL.createObjectURL(blob);
      atual.current = endereco;
      setUrl(endereco);
    } catch (falha) {
      setError(toApiError(falha));
    } finally {
      setLoading(false);
    }
  }, [artifactType, descartar]);

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        disabled={loading}
        onClick={abrir}
        aria-label={`Ver exemplo de ${modelName}`}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Eye className="size-4" />
        )}
        {loading ? "Montando…" : "Ver exemplo"}
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
            <DialogTitle>{modelName}</DialogTitle>
            <DialogDescription>
              Exemplo com dados fictícios e o timbre da sua organização. Nada
              aqui foi emitido nem guardado.
            </DialogDescription>
          </DialogHeader>

          <MutationError error={error} />

          {url ? (
            <>
              <iframe
                src={url}
                title={`Exemplo de ${modelName}`}
                className="min-h-0 flex-1 rounded-lg border border-border"
              />
              <div className="flex justify-end">
                {/* Escape para quem prefere o leitor de PDF do sistema, ou quer
                    imprimir sem o cromo do diálogo. */}
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
