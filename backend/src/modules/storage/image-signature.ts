/**
 * O que os primeiros bytes de um arquivo dizem que ele é.
 *
 * ## Por que o cabeçalho não serve
 *
 * `Content-Type` é o que o cliente **declara**, e quem envia o arquivo é quem
 * escolhe o que declarar. Um executável renomeado para `.png` chega com
 * `image/png` no cabeçalho e continua sendo um executável. A assinatura no
 * início do arquivo é o que ele **é**.
 *
 * ## Por que isto é compartilhado
 *
 * A mesma verificação vale para assinatura profissional, aceite do cliente e
 * foto de perfil. Três cópias significariam que um dia uma delas ganharia um
 * formato novo — ou uma correção — e as outras duas não.
 */

/** Os formatos que o produto aceita como imagem enviada por pessoa. */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * O tipo real do conteúdo, ou `null` quando não é nenhum dos aceitos.
 *
 * `null` é recusa, e não "desconhecido, deixa passar": quem chama trata a
 * ausência como arquivo inválido.
 */
export function detectImageMime(body: Buffer): AcceptedImageMimeType | null {
  if (body.length >= 8 && body.subarray(0, 8).equals(PNG)) return 'image/png';
  if (
    body.length >= 3 &&
    body[0] === 0xff &&
    body[1] === 0xd8 &&
    body[2] === 0xff
  )
    return 'image/jpeg';

  /**
   * WEBP é um contêiner RIFF: os quatro primeiros bytes dizem só "isto é um
   * RIFF", e é o rótulo em 8..12 que distingue WEBP de WAV e de AVI.
   */
  if (
    body.length >= 12 &&
    body.toString('ascii', 0, 4) === 'RIFF' &&
    body.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  return null;
}
