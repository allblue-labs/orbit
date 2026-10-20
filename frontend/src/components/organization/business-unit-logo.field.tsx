"use client";

/**
 * A marca que timbra os documentos emitidos pela unidade.
 *
 * ## O que o navegador faz antes de enviar
 *
 * Reduz a imagem. O arquivo que a pessoa tem à mão é o de alta resolução — o
 * mesmo da fachada — e no documento a marca é desenhada com 30 pontos de
 * altura. Enviar o original faria o servidor recusar por tamanho, e a pessoa
 * receberia um erro sem saber o que fazer com ele.
 *
 * A redução é conveniência de quem envia, não barreira: o servidor valida de
 * novo o que chega, porque quem quiser mandar outra coisa fala direto com a
 * API.
 *
 * ## Por que mostra onde vai aparecer
 *
 * Marca clara sobre cabeçalho claro some, e isso só se descobre depois de
 * emitir. A prévia desenha sobre o mesmo fundo do documento.
 */
import { useRef, useState } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  useRemoveBusinessUnitLogo,
  useSetBusinessUnitLogo,
} from "@/hooks/organization/use-organization";
import { prepareBrandImage } from "@/lib/brand-image";

export function BusinessUnitLogoField({
  unitId,
  hasLogo,
  canManage,
}: {
  unitId: string;
  hasLogo: boolean;
  canManage: boolean;
}) {
  const enviar = useSetBusinessUnitLogo(unitId);
  const remover = useRemoveBusinessUnitLogo(unitId);
  const entrada = useRef<HTMLInputElement>(null);

  /** A prévia local: o que foi escolhido agora, antes de recarregar a lista. */
  const [previa, setPrevia] = useState<string | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const ocupado = enviar.isPending || remover.isPending;
  const temMarca = previa !== null || hasLogo;

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setErroLocal(null);

    const preparada = await prepareBrandImage(arquivo);
    if (!preparada.ok) {
      setErroLocal(preparada.error.message);
      return;
    }

    setPrevia(preparada.dataUrl);
    enviar.mutate(preparada.dataUrl, {
      onError: () => setPrevia(null),
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Marca da unidade</p>
        <p className="text-muted-foreground text-xs">
          Aparece no cabeçalho dos documentos emitidos por esta unidade — PMOC,
          ordem de serviço, orçamento e os demais.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {/* O fundo é o do cabeçalho do documento: marca clara sobre claro some,
            e esse é o tipo de coisa que se descobre tarde demais. */}
        <div className="flex h-20 w-44 items-center justify-center rounded-lg border border-border bg-white p-3">
          {previa ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previa}
              alt="Marca da organização"
              className="max-h-full max-w-full object-contain"
            />
          ) : hasLogo ? (
            <span className="text-muted-foreground text-xs">
              Marca cadastrada
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">
              Sem marca — o documento sai sem timbre
            </span>
          )}
        </div>

        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <input
              ref={entrada}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(evento) => {
                void escolher(evento.target.files?.[0]);
                /* Limpa para que escolher o mesmo arquivo de novo dispare o
                   evento — depois de um erro, é o que a pessoa tenta. */
                evento.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={ocupado}
              onClick={() => entrada.current?.click()}
            >
              {enviar.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImageUp className="size-4" />
              )}
              {temMarca ? "Trocar marca" : "Enviar marca"}
            </Button>

            {temMarca ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado}
                onClick={() =>
                  remover.mutate(undefined, {
                    onSuccess: () => setPrevia(null),
                  })
                }
              >
                <Trash2 className="size-4" />
                Remover
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {erroLocal ? (
        <p className="text-destructive text-xs">{erroLocal}</p>
      ) : null}
      <MutationError error={enviar.error ?? remover.error} />
    </div>
  );
}
