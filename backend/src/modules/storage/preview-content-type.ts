import { detectImageMime } from './image-signature';

/**
 * O tipo com que o storage **local** serve uma pré-visualização.
 *
 * O provider local não guarda o tipo do objeto, e servia tudo como
 * `application/octet-stream` com `nosniff` — o navegador recusava exibir o PDF
 * e o visualizador de documentos mostrava uma página quebrada. No R2 o tipo
 * gravado no objeto já resolve isso.
 *
 * Decidido pelos **bytes**, e só para o que é seguro abrir inline: PDF e
 * imagem. HTML nunca: servido como `text/html` pela origem da aplicação, o
 * documento de um tenant viraria página executável. O que não for reconhecido
 * continua `octet-stream`.
 */
export function previewContentType(body: Buffer): string {
  if (body.length >= 5 && body.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  return detectImageMime(body) ?? 'application/octet-stream';
}
