/**
 * Imagem embutida como data URI, validada.
 *
 * ## Por que só data URI
 *
 * O logo de uma unidade de negócio é conteúdo que o próprio inquilino envia, e
 * ele termina desenhado dentro de um PDF gerado no servidor. Aceitar uma URL
 * e buscá-la faria o backend emitir requisição para um endereço escolhido pelo
 * cliente — SSRF, com a rede interna ao alcance. Data URI não sai da máquina.
 *
 * ## Por que só PNG e JPEG
 *
 * SVG é documento, não imagem: carrega script e referência externa. Um SVG
 * aceito aqui seria conteúdo ativo dentro de um documento que circula por
 * e-mail. PNG e JPEG são raster e não executam nada.
 *
 * ## Por que há limite de tamanho
 *
 * O logo é desenhado em 104×28 pontos. Um arquivo de 40 MB produziria o mesmo
 * carimbo, depois de o servidor carregá-lo inteiro na memória uma vez por
 * documento — e documentos são gerados em lote.
 *
 * A política nasceu no gerador de QR de equipamento e vale igual aqui; mora em
 * `common` porque uma regra de segurança que existe em duas cópias é uma regra
 * que vai divergir.
 */

const DATA_URI = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

/** 512 KB: sobra para um logo de boa qualidade, longe de um upload acidental. */
const TAMANHO_MAXIMO = 512_000;

export interface EmbeddedImage {
  readonly bytes: Buffer;
  readonly mimeType: string;
  /** O data URI original, para quem precisa devolvê-lo ao HTML. */
  readonly dataUrl: string;
}

export function readEmbeddedImage(value?: string | null): EmbeddedImage | null {
  if (!value) return null;

  const encontrado = DATA_URI.exec(value);
  if (!encontrado) return null;

  const bytes = Buffer.from(encontrado[2]!, 'base64');
  if (bytes.length === 0 || bytes.length > TAMANHO_MAXIMO) return null;

  return {
    bytes,
    mimeType: `image/${encontrado[1]!}`,
    dataUrl: value,
  };
}
