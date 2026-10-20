"use client";

/**
 * Área de desenho da assinatura.
 *
 * ## Pointer Events, não mouse nem touch
 *
 * Um só conjunto de eventos cobre mouse, dedo e caneta. Tratar `mouse*` e
 * `touch*` em paralelo é o caminho conhecido para o traço duplicado — o
 * navegador emite os dois para o mesmo gesto — e deixa a caneta de fora, que é
 * justamente quem assina melhor.
 *
 * ## Nada é enviado enquanto se desenha
 *
 * O traço vive na tela. Só a confirmação produz imagem e envia. Salvar a cada
 * movimento criaria dezenas de versões de uma assinatura que a pessoa ainda
 * está fazendo.
 *
 * ## O que sai daqui
 *
 * Um PNG com fundo transparente, recortado nos limites do traço e com uma
 * margem. Recortar importa: sem isso a assinatura vira um retângulo com muito
 * espaço vazio, e no documento ela aparece minúscula no meio de um vazio.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Densidade do traço final.
 *
 * Alta o bastante para o documento impresso, baixa o bastante para o arquivo
 * não passar de algumas dezenas de kilobytes. Uma assinatura em 4K não fica
 * melhor no PDF — fica maior.
 */
const ESCALA_DE_SAIDA = 2;

/** Margem em volta do traço recortado, em pixels da imagem final. */
const MARGEM = 16;

/**
 * O mínimo para valer como assinatura.
 *
 * Um toque acidental produz um ponto. Exigir que o traço tenha alguma
 * extensão nos dois eixos, ou comprimento acumulado, separa "assinou" de
 * "encostou". Não é biometria e não julga a assinatura: só distingue de um
 * clique.
 */
const EXTENSAO_MINIMA = 24;
const COMPRIMENTO_MINIMO = 60;

interface Ponto {
  x: number;
  y: number;
}

export interface SignaturePadHandle {
  limpar: () => void;
  vazio: () => boolean;
  /** PNG normalizado, ou `null` quando não há traço que valha. */
  exportar: () => Promise<Blob | null>;
}

export function SignaturePad({
  onChange,
  disabled = false,
  label = "Desenhe sua assinatura",
  handleRef,
}: {
  /** Avisa quando passa a existir (ou deixa de existir) traço válido. */
  onChange?: (temTraco: boolean) => void;
  disabled?: boolean;
  label?: string;
  handleRef: React.MutableRefObject<SignaturePadHandle | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tracos = useRef<Ponto[][]>([]);
  const desenhando = useRef(false);
  const [temTraco, setTemTraco] = useState(false);

  /** Redesenha tudo. Usado no `resize`, quando o canvas perde o conteúdo. */
  const repintar = useCallback(() => {
    const canvas = canvasRef.current;
    const contexto = canvas?.getContext("2d");
    if (!canvas || !contexto) return;

    const razao = window.devicePixelRatio || 1;
    const largura = canvas.clientWidth;
    const altura = canvas.clientHeight;
    canvas.width = Math.floor(largura * razao);
    canvas.height = Math.floor(altura * razao);
    contexto.scale(razao, razao);

    contexto.lineWidth = 2.2;
    contexto.lineCap = "round";
    contexto.lineJoin = "round";
    contexto.strokeStyle = "#111827";
    contexto.clearRect(0, 0, largura, altura);

    for (const traco of tracos.current) {
      if (traco.length === 0) continue;
      contexto.beginPath();
      contexto.moveTo(traco[0].x, traco[0].y);
      for (const ponto of traco.slice(1)) contexto.lineTo(ponto.x, ponto.y);

      /** Um ponto isolado não desenha nada com `lineTo`; o arco desenha. */
      if (traco.length === 1) contexto.arc(traco[0].x, traco[0].y, 1.1, 0, 7);
      contexto.stroke();
    }
  }, []);

  useEffect(() => {
    repintar();
    const observer = new ResizeObserver(() => repintar());
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [repintar]);

  const pontoDe = (event: React.PointerEvent<HTMLCanvasElement>): Ponto => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const comecar = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;

    /**
     * Captura o ponteiro: o traço continua enquanto o dedo sai da área, em vez
     * de ser cortado na borda. Quem assina rápido passa do retângulo.
     *
     * E é por isso que **não** existe `onPointerLeave` encerrando o traço: a
     * captura já emite um evento de saída no instante em que começa, e tratá-lo
     * como fim cortava toda assinatura no primeiro ponto.
     */
    event.currentTarget.setPointerCapture(event.pointerId);
    desenhando.current = true;
    tracos.current.push([pontoDe(event)]);
    repintar();
  };

  const mover = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhando.current || disabled) return;
    tracos.current[tracos.current.length - 1]?.push(pontoDe(event));
    repintar();
  };

  const terminar = () => {
    if (!desenhando.current) return;
    desenhando.current = false;
    const valido = temTracoValido(tracos.current);
    setTemTraco(valido);
    onChange?.(valido);
  };

  const limpar = useCallback(() => {
    tracos.current = [];
    setTemTraco(false);
    onChange?.(false);
    repintar();
  }, [onChange, repintar]);

  /**
   * O punho é publicado num efeito, não durante a renderização.
   *
   * Escrever numa ref enquanto o React renderiza é um efeito colateral no meio
   * de uma função que deve ser pura — em modo concorrente a renderização pode
   * ser descartada, e o pai ficaria com um punho de uma árvore que não existe.
   */
  useEffect(() => {
    handleRef.current = {
      limpar,
      vazio: () => !temTracoValido(tracos.current),
      exportar: () => exportarPng(tracos.current),
    };
    const atual = handleRef;
    return () => {
      atual.current = null;
    };
  }, [handleRef, limpar]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        className="h-44 w-full touch-none rounded-lg border border-border bg-white"
        onPointerDown={comecar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerCancel={terminar}
      />
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {temTraco
          ? "Assinatura desenhada. Confirme para salvar."
          : `${label}. Use o mouse, o dedo ou a caneta.`}
      </p>
    </div>
  );
}

/**
 * Houve traço, ou só um encostão?
 *
 * Exportado porque o teste cobra exatamente esta fronteira, e porque a mesma
 * pergunta é feita fora do componente antes de habilitar o botão.
 */
export function temTracoValido(tracos: readonly Ponto[][]): boolean {
  const pontos = tracos.flat();
  if (pontos.length < 2) return false;

  const xs = pontos.map((p) => p.x);
  const ys = pontos.map((p) => p.y);
  const larguraDoTraco = Math.max(...xs) - Math.min(...xs);
  const alturaDoTraco = Math.max(...ys) - Math.min(...ys);

  let comprimento = 0;
  for (const traco of tracos) {
    for (let i = 1; i < traco.length; i += 1) {
      comprimento += Math.hypot(
        traco[i].x - traco[i - 1].x,
        traco[i].y - traco[i - 1].y,
      );
    }
  }

  return (
    comprimento >= COMPRIMENTO_MINIMO ||
    larguraDoTraco >= EXTENSAO_MINIMA ||
    alturaDoTraco >= EXTENSAO_MINIMA
  );
}

/**
 * Os traços viram PNG recortado.
 *
 * Fundo transparente: o documento tem o próprio fundo, e um retângulo branco
 * colado sobre ele apareceria como um retângulo branco. O traço é escuro, que
 * é o que funciona sobre papel e sobre PDF claro.
 */
export async function exportarPng(
  tracos: readonly Ponto[][],
): Promise<Blob | null> {
  if (!temTracoValido(tracos)) return null;

  const pontos = tracos.flat();
  const minX = Math.min(...pontos.map((p) => p.x));
  const maxX = Math.max(...pontos.map((p) => p.x));
  const minY = Math.min(...pontos.map((p) => p.y));
  const maxY = Math.max(...pontos.map((p) => p.y));

  const largura = Math.ceil((maxX - minX) * ESCALA_DE_SAIDA) + MARGEM * 2;
  const altura = Math.ceil((maxY - minY) * ESCALA_DE_SAIDA) + MARGEM * 2;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(largura, MARGEM * 2 + 1);
  canvas.height = Math.max(altura, MARGEM * 2 + 1);
  const contexto = canvas.getContext("2d");
  if (!contexto) return null;

  contexto.lineWidth = 2.2 * ESCALA_DE_SAIDA;
  contexto.lineCap = "round";
  contexto.lineJoin = "round";
  contexto.strokeStyle = "#111827";

  const projetar = (ponto: Ponto): Ponto => ({
    x: (ponto.x - minX) * ESCALA_DE_SAIDA + MARGEM,
    y: (ponto.y - minY) * ESCALA_DE_SAIDA + MARGEM,
  });

  for (const traco of tracos) {
    if (traco.length === 0) continue;
    const inicio = projetar(traco[0]);
    contexto.beginPath();
    contexto.moveTo(inicio.x, inicio.y);
    for (const ponto of traco.slice(1)) {
      const alvo = projetar(ponto);
      contexto.lineTo(alvo.x, alvo.y);
    }
    if (traco.length === 1) contexto.arc(inicio.x, inicio.y, 1.1, 0, 7);
    contexto.stroke();
  }

  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob), "image/png"),
  );
}
