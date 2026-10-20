"use client";

/**
 * A marca da empresa, onde as pessoas a procuram.
 *
 * ## Por que aqui, e não só no cadastro da unidade
 *
 * O logo existia só por unidade de negócio, dentro do diálogo de edição da
 * unidade. Quem opera com uma unidade — o caso comum — abria Configurações ›
 * Organização à procura da marca da empresa e não encontrava nada além de um
 * editor de JSON. Agora a empresa tem a sua, e ela timbra os documentos de toda
 * unidade que não tenha marca própria.
 *
 * ## Mostra a marca guardada, não só que existe
 *
 * O campo da unidade escreve "Marca cadastrada", porque a listagem de unidades
 * publica apenas `hasLogo` — carregar meio megabyte por linha seria caro. Aqui
 * há uma consulta dedicada (`GET current/logo`), então a prévia desenha a
 * imagem de verdade: quem volta à tela confere o que está valendo em vez de
 * confiar num rótulo.
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
  useOrganizationLogo,
  useRemoveOrganizationLogo,
  useSetOrganizationLogo,
} from "@/hooks/organization/use-organization";
import { prepareBrandImage } from "@/lib/brand-image";

export function OrganizationLogoField({ canManage }: { canManage: boolean }) {
  const marca = useOrganizationLogo();
  const enviar = useSetOrganizationLogo();
  const remover = useRemoveOrganizationLogo();
  const entrada = useRef<HTMLInputElement>(null);

  /** O que foi escolhido agora, antes de a consulta reler. */
  const [previa, setPrevia] = useState<string | null>(null);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  const ocupado = enviar.isPending || remover.isPending;
  const atual = previa ?? marca.data?.logoUrl ?? null;

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
        <p className="text-sm font-medium">Logo da empresa</p>
        <p className="text-muted-foreground text-xs">
          Aparece no cabeçalho dos documentos — PMOC, ordem de serviço,
          orçamento, relatório e os demais. Uma unidade com marca própria usa a
          dela; as outras usam esta.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {/* O fundo é o do cabeçalho do documento: marca clara sobre claro some,
            e esse é o tipo de coisa que se descobre tarde demais. */}
        <div className="flex h-20 w-44 items-center justify-center rounded-lg border border-border bg-white p-3">
          {atual ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={atual}
              alt="Logo da empresa"
              className="max-h-full max-w-full object-contain"
            />
          ) : marca.isPending ? (
            <Loader2
              className="text-muted-foreground size-4 animate-spin"
              aria-hidden
            />
          ) : (
            <span className="text-muted-foreground text-xs">
              Sem logo — o documento sai sem timbre
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
              {atual ? "Trocar logo" : "Enviar logo"}
            </Button>

            {atual ? (
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
