"use client";

/**
 * Recorte da foto de perfil.
 *
 * ## Por que recortar antes de enviar
 *
 * O avatar é redondo e aparece em 32 px no topo e em 20 px nas listas. Uma foto
 * enviada crua entra deformada ou com a cabeça fora do círculo, e a pessoa só
 * descobre depois — o único conserto era mandar outra foto e torcer.
 *
 * Recortar aqui também **encolhe**: a saída é 512×512, então uma foto de 4 MB
 * de celular vira alguns KB e passa no limite de 2 MB do servidor sem que
 * ninguém precise redimensionar antes.
 *
 * ## Os bytes enviados são os bytes recortados
 *
 * O upload declara `mimeType` e `sizeBytes`, e o backend relê o que foi gravado
 * conferindo assinatura de formato e hash. Por isso o `File` que sai daqui é
 * construído a partir do próprio blob do canvas — declarar o arquivo original e
 * enviar outro seria recusado, com razão.
 *
 * ## Sem biblioteca de recorte
 *
 * São três gestos — arrastar, aproximar, confirmar — e a matemática cabe em uma
 * função. Uma dependência para isso traria seu próprio modelo de toque, seus
 * próprios estilos e sua própria versão de React para manter.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

/** Lado da imagem final, em pixels. Cobre o maior uso (80 px) com folga de tela retina. */
const SAIDA = 512;

/** Lado da área de recorte na tela. */
const VIEWPORT = 288;

const ZOOM_MINIMO = 1;
const ZOOM_MAXIMO = 4;

export function AvatarCropDialog({
  file,
  onCancel,
  onConfirm,
  isPending,
}: {
  /** O arquivo escolhido; `null` mantém o diálogo fechado. */
  file: File | null;
  onCancel: () => void;
  onConfirm: (recortado: File) => void;
  isPending: boolean;
}) {
  if (!file) return null;

  return (
    <Dialog open onOpenChange={(aberto) => (aberto ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-md">
        {/* `key` no arquivo: trocar de foto recomeça o enquadramento, em vez de
            herdar o zoom e a posição da foto anterior. */}
        <Corpo
          key={`${file.name}:${file.size}:${file.lastModified}`}
          file={file}
          onCancel={onCancel}
          onConfirm={onConfirm}
          isPending={isPending}
        />
      </DialogContent>
    </Dialog>
  );
}

function Corpo({
  file,
  onCancel,
  onConfirm,
  isPending,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (recortado: File) => void;
  isPending: boolean;
}) {
  const [imagem, setImagem] = useState<HTMLImageElement | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const arrasto = useRef<{ x: number; y: number } | null>(null);

  /**
   * A imagem é lida uma vez, por object URL, e o URL é revogado no fim.
   *
   * Sem revogar, cada foto escolhida deixaria os bytes presos na memória da
   * aba até ela fechar — e trocar de foto algumas vezes é o caso normal.
   */
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const elemento = new Image();
    elemento.onload = () => setImagem(elemento);
    elemento.onerror = () =>
      setErro("Não foi possível abrir esta imagem. Tente outro arquivo.");
    elemento.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** Escala em que a imagem cobre exatamente o quadrado do recorte. */
  const base = imagem
    ? VIEWPORT / Math.min(imagem.naturalWidth, imagem.naturalHeight)
    : 1;
  const escala = base * zoom;
  const largura = imagem ? imagem.naturalWidth * escala : 0;
  const altura = imagem ? imagem.naturalHeight * escala : 0;

  /**
   * O recorte nunca mostra vazio.
   *
   * O deslocamento é preso à borda: a imagem sempre cobre o quadrado inteiro.
   * Sem isso, arrastar para o canto deixaria uma faixa transparente que viraria
   * um pedaço branco na foto final.
   */
  const limitar = useCallback(
    (proposto: { x: number; y: number }) => {
      const maximoX = Math.max(0, (largura - VIEWPORT) / 2);
      const maximoY = Math.max(0, (altura - VIEWPORT) / 2);
      return {
        x: Math.min(maximoX, Math.max(-maximoX, proposto.x)),
        y: Math.min(maximoY, Math.max(-maximoY, proposto.y)),
      };
    },
    [largura, altura],
  );

  /**
   * O deslocamento efetivo é **derivado**, não guardado já limitado.
   *
   * Afastar a imagem reduz o quanto ela pode ser arrastada. Corrigir isso num
   * efeito depois da renderização mostraria um quadro com a imagem fora do
   * lugar antes de voltar — e o que o canvas desenha tem de ser exatamente o
   * que se viu. Limitando aqui, zoom e posição mudam no mesmo quadro.
   */
  const enquadramento = limitar(offset);

  const aoPressionar = (evento: React.PointerEvent<HTMLDivElement>) => {
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrasto.current = {
      x: evento.clientX - enquadramento.x,
      y: evento.clientY - enquadramento.y,
    };
  };

  const aoMover = (evento: React.PointerEvent<HTMLDivElement>) => {
    const origem = arrasto.current;
    if (!origem) return;
    setOffset({
      x: evento.clientX - origem.x,
      y: evento.clientY - origem.y,
    });
  };

  const aoSoltar = () => {
    arrasto.current = null;
  };

  const confirmar = async () => {
    if (!imagem) return;
    try {
      onConfirm(await recortar(imagem, escala, enquadramento, file.name));
    } catch {
      setErro("Não foi possível recortar a imagem. Tente outro arquivo.");
    }
  };

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle>Enquadre sua foto</DialogTitle>
        <DialogDescription>
          Arraste para posicionar e aproxime até ficar como você quer. O avatar
          é redondo.
        </DialogDescription>
      </DialogHeader>

      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : (
        <div className="space-y-4">
          <div
            className="relative mx-auto touch-none overflow-hidden rounded-lg bg-muted"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={aoPressionar}
            onPointerMove={aoMover}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
            data-testid="avatar-crop-viewport"
          >
            {imagem ? (
              /*
               * `<img>` cru e posicionado à mão: o que está na tela precisa ser
               * exatamente o que o canvas vai desenhar, e qualquer camada de
               * otimização entre os dois desalinharia o recorte do que se viu.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imagem.src}
                alt=""
                draggable={false}
                className="absolute top-1/2 left-1/2 max-w-none select-none"
                style={{
                  width: largura,
                  height: altura,
                  transform: `translate(-50%, -50%) translate(${enquadramento.x}px, ${enquadramento.y}px)`,
                }}
              />
            ) : null}

            {/*
              A máscara é só visual.

              Um círculo com sombra enorme para fora escurece tudo o que está
              além dele — o contêiner tem `overflow-hidden`, então a sombra para
              na borda. A imagem gravada continua **quadrada**: quem arredonda é
              o avatar, em cada lugar onde ele aparece.
            */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] ring-1 ring-white/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="avatar-zoom" className="text-xs">
              Aproximação
            </Label>
            <div className="flex items-center gap-3">
              <ZoomOut
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <Slider
                id="avatar-zoom"
                min={ZOOM_MINIMO}
                max={ZOOM_MAXIMO}
                step={0.01}
                value={[zoom]}
                onValueChange={([valor]) => setZoom(valor ?? 1)}
                disabled={!imagem}
              />
              <ZoomIn
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={() => void confirmar()}
          disabled={!imagem || Boolean(erro) || isPending}
        >
          {isPending ? "Enviando…" : "Usar esta foto"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * Desenha o que está enquadrado e devolve um arquivo.
 *
 * A conta é a inversa da que posiciona a imagem na tela: do canto do quadrado
 * de recorte, em coordenadas de tela, para coordenadas da imagem original.
 *
 * PNG na saída, sempre. O formato de entrada pode ser JPEG ou WEBP, e reencodar
 * como PNG evita duas perdas — a do arquivo original e a do reencode — num
 * arquivo que, a 512 px, é pequeno de qualquer jeito.
 */
async function recortar(
  imagem: HTMLImageElement,
  escala: number,
  offset: { x: number; y: number },
  nomeOriginal: string,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = SAIDA;
  canvas.height = SAIDA;
  const contexto = canvas.getContext("2d");
  if (!contexto) throw new Error("Canvas indisponível");

  const ladoNaOrigem = VIEWPORT / escala;
  const origemX =
    imagem.naturalWidth / 2 - ladoNaOrigem / 2 - offset.x / escala;
  const origemY =
    imagem.naturalHeight / 2 - ladoNaOrigem / 2 - offset.y / escala;

  contexto.drawImage(
    imagem,
    origemX,
    origemY,
    ladoNaOrigem,
    ladoNaOrigem,
    0,
    0,
    SAIDA,
    SAIDA,
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("Não foi possível gerar a imagem");

  const base = nomeOriginal.replace(/\.[^.]+$/, "") || "foto";
  return new File([blob], `${base}.png`, { type: "image/png" });
}
