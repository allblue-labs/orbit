/**
 * Prepara a marca da empresa para virar timbre de documento.
 *
 * ## Por que redimensionar aqui
 *
 * O arquivo que a pessoa tem à mão é o de alta resolução — o mesmo que ela usa
 * em fachada e camiseta. No documento ele é desenhado com 30 pontos de altura,
 * cerca de 125 pixels em impressão de boa qualidade: um PNG de vários
 * megabytes produz exatamente o mesmo carimbo depois de atravessar a rede e
 * ocupar a memória do servidor uma vez por documento gerado, em lote.
 *
 * Reduzir antes de enviar resolve os dois lados: o upload passa, e o que fica
 * guardado é do tamanho do uso. Sem isso, o backend recusaria o arquivo e a
 * pessoa não teria como saber o que fazer com a recusa.
 *
 * ## O que não se faz aqui
 *
 * Não se decide se a imagem é aceitável — isso é do servidor, que valida de
 * novo o que chega. O navegador é conveniência para quem envia, nunca a
 * barreira: quem quiser mandar outra coisa fala direto com a API.
 */

/** Altura em que o documento desenha a marca, com folga para impressão. */
const ALTURA_ALVO = 160;
const LARGURA_MAXIMA = 720;

/** O mesmo teto do servidor, para a recusa não vir de lá. */
const TAMANHO_MAXIMO = 512_000;

export interface BrandImageError {
  readonly kind: "type" | "size" | "decode";
  readonly message: string;
}

export type BrandImageResult =
  | { readonly ok: true; readonly dataUrl: string; readonly bytes: number }
  | { readonly ok: false; readonly error: BrandImageError };

const ACEITOS = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * Lê o arquivo, reduz para o tamanho de uso e devolve o data URI.
 *
 * A saída é sempre PNG: preserva transparência, que é o que a maioria das
 * marcas usa, e evita que um JPEG com fundo branco ganhe um retângulo visível
 * sobre o cabeçalho claro.
 */
export async function prepareBrandImage(
  file: File,
): Promise<BrandImageResult> {
  if (!ACEITOS.has(file.type)) {
    return {
      ok: false,
      error: {
        kind: "type",
        message: "Envie a marca em PNG, JPEG ou WebP.",
      },
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return {
      ok: false,
      error: {
        kind: "decode",
        message: "Não foi possível ler esta imagem. Tente outro arquivo.",
      },
    };
  }

  const escala = Math.min(
    ALTURA_ALVO / bitmap.height,
    LARGURA_MAXIMA / bitmap.width,
    /* Marca pequena não é ampliada: esticar um logo de 40px o deixa borrado, e
       o documento fica melhor com ele no tamanho que tem. */
    1,
  );

  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const contexto = canvas.getContext("2d");
  if (!contexto) {
    return {
      ok: false,
      error: {
        kind: "decode",
        message: "Não foi possível preparar a imagem neste navegador.",
      },
    };
  }

  contexto.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/png");
  const bytes = Math.ceil(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

  if (bytes > TAMANHO_MAXIMO) {
    return {
      ok: false,
      error: {
        kind: "size",
        message:
          "A imagem ficou grande demais mesmo depois de reduzida. " +
          "Tente uma versão com menos detalhes ou sem fundo.",
      },
    };
  }

  return { ok: true, dataUrl, bytes };
}
