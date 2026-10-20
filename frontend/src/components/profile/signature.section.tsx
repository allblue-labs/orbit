"use client";

/**
 * Minha assinatura — a representação gráfica da assinatura profissional.
 *
 * ## O que ela é
 *
 * A imagem da assinatura da pessoa, usada nos documentos que ela assina. **Não
 * é** assinatura digital certificada, ICP-Brasil nem certificado — e nenhum
 * texto desta tela sugere que seja.
 *
 * ## Duas formas, um resultado
 *
 * Desenhar ou enviar uma imagem produzem o mesmo objeto: uma nova **versão**
 * de `UserSignature`. Nunca uma sobrescrita — documento já emitido continua
 * com a assinatura que tinha no dia, e é essa a razão de o histórico existir.
 *
 * ## Pessoal, não da organização
 *
 * Fica em Minha conta e não em Configurações: a assinatura é de quem assina.
 */
import { useRef, useState } from "react";
import { PenLine, Upload } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/signature/signature-pad";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSignature, useUploadSignature } from "@/hooks/profile/use-me-media";
import { browserUrlFor } from "@/lib/backend-url";
import { formatDateTime } from "@/lib/formatters";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
} from "@/services/me-media.service";

export function SignatureSection() {
  const query = useSignature();

  return (
    <PanelFrame
      panelId="profile-signature"
      title="Minha assinatura"
      description="A imagem da sua assinatura, aplicada aos documentos que você assina"
    >
      <PanelState query={toPanelQuery(query)} loadingRows={4}>
        {(status) => (
          <div className="space-y-5">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              {status.signatureAvailable ? (
                <div className="space-y-2">
                  {/* Sobre branco, que é o fundo em que ela vai ser aplicada:
                      traço claro sobre cinza parece legível e some no
                      documento. */}
                  {status.preview ? (
                    <div className="flex h-24 items-center justify-center rounded-md border border-border bg-white p-2">
                      {/* `<img>`, e não `next/image`: o endereço é assinado e
                          expira, então não há o que otimizar em rota estática.

                          `browserUrlFor` porque o backend devolve o caminho
                          **dele** (`/api/v1/…`), certo para o aplicativo de
                          campo e inexistente na origem do frontend: a imagem
                          respondia 404 e a assinatura aparecia como um quadro
                          vazio. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={browserUrlFor(status.preview.url)}
                        alt="Sua assinatura"
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : null}
                  <p className="text-sm text-foreground">
                    Assinatura cadastrada
                    {status.version ? ` · versão ${status.version}` : ""}
                    {status.updatedAt
                      ? ` · atualizada em ${formatDateTime(status.updatedAt)}`
                      : ""}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Você ainda não cadastrou sua assinatura.
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                Cadastrar uma nova assinatura cria uma versão. Documentos já
                emitidos continuam com a assinatura que tinham.
              </p>
            </div>

            <SignatureForms substituindo={status.signatureAvailable} />
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function SignatureForms({ substituindo }: { substituindo: boolean }) {
  const upload = useUploadSignature();
  const pad = useRef<SignaturePadHandle | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const [temTraco, setTemTraco] = useState(false);
  const [recusa, setRecusa] = useState<string | null>(null);
  /**
   * O envio que espera confirmação.
   *
   * Substituir abre versão nova, e quem tinha acabado de desenhar perde o
   * traço se errar o botão. Guardar o envio aqui deixa o diálogo decidir sem
   * que o formulário precise saber que ele existe.
   */
  const [confirmando, setConfirmando] = useState<{
    blob: Blob;
    fileName: string;
    aoConfirmar?: () => void;
  } | null>(null);

  const enviar = (envio: {
    blob: Blob;
    fileName: string;
    aoConfirmar?: () => void;
  }) => {
    upload.mutate(
      { blob: envio.blob, fileName: envio.fileName },
      { onSuccess: envio.aoConfirmar },
    );
  };

  const pedirEnvio = (envio: {
    blob: Blob;
    fileName: string;
    aoConfirmar?: () => void;
  }) => {
    if (substituindo) {
      setConfirmando(envio);
      return;
    }
    enviar(envio);
  };

  const confirmarDesenho = async () => {
    const blob = await pad.current?.exportar();
    if (!blob) {
      setRecusa("Desenhe sua assinatura antes de confirmar.");
      return;
    }
    setRecusa(null);
    pedirEnvio({
      blob,
      fileName: "assinatura.png",
      aoConfirmar: () => pad.current?.limpar(),
    });
  };

  const escolherArquivo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as never)) {
      setRecusa("Escolha uma imagem PNG, JPEG ou WEBP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setRecusa("A imagem deve ter no máximo 2 MB.");
      return;
    }
    setRecusa(null);
    pedirEnvio({ blob: file, fileName: file.name });
  };

  return (
    <Tabs defaultValue="desenhar">
      <TabsList aria-label="Como cadastrar a assinatura">
        <TabsTrigger value="desenhar">
          <PenLine className="size-4" aria-hidden />
          Desenhar assinatura
        </TabsTrigger>
        <TabsTrigger value="enviar">
          <Upload className="size-4" aria-hidden />
          Enviar imagem
        </TabsTrigger>
      </TabsList>

      <TabsContent value="desenhar" className="space-y-3 pt-4">
        <SignaturePad handleRef={pad} onChange={setTemTraco} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              pad.current?.limpar();
              setRecusa(null);
            }}
          >
            Limpar
          </Button>
          <Button
            type="button"
            size="sm"
            /*
              Desabilitado enquanto não há traço: confirmar um pad vazio
              produziria uma "assinatura" que é um retângulo transparente.
            */
            disabled={!temTraco || upload.isPending}
            onClick={() => void confirmarDesenho()}
          >
            {substituindo ? "Substituir assinatura" : "Confirmar assinatura"}
          </Button>
        </div>
      </TabsContent>

      <TabsContent value="enviar" className="space-y-3 pt-4">
        <p className="text-sm text-muted-foreground">
          Envie uma foto ou digitalização da sua assinatura. PNG, JPEG ou WEBP,
          até 2 MB. Fundo claro e traço escuro funcionam melhor no documento.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <Upload className="size-4" aria-hidden />
          Escolher imagem
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          className="sr-only"
          aria-label="Escolher imagem da assinatura"
          onChange={escolherArquivo}
        />
      </TabsContent>

      {recusa ? (
        <p role="alert" className="pt-3 text-xs text-destructive">
          {recusa}
        </p>
      ) : null}
      <MutationError error={upload.error} />

      <AlertDialog
        open={confirmando !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setConfirmando(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir sua assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              A assinatura atual deixa de ser usada e a nova passa a valer nos
              próximos documentos. Os documentos já emitidos continuam com a
              assinatura que tinham — nada muda no que já foi entregue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter a atual</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmando) enviar(confirmando);
                setConfirmando(null);
              }}
            >
              Substituir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
