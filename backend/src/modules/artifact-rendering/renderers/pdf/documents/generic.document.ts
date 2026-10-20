/**
 * O documento de quem não tem compositor próprio.
 *
 * Um template que a organização criou não tem estrutura conhecida — e inventar
 * uma seria pior que imprimir o que ele diz. Aqui as seções saem como cartões
 * de definição, dentro da mesma moldura de marca que os documentos do
 * catálogo: o template é genérico, a apresentação não precisa ser pobre.
 */
import {
  definitionCard,
  noteBlock,
  sectionTitle,
  type DefinitionItem,
} from '../kit/blocks';
import { photoGrid, signatureBlock } from '../kit/media-blocks';
import type { DocumentTheme } from '../kit/theme';
import type { RenderInput } from '../../artifact-renderer';
import { formatAnswer } from '../../html/html-safe';
import { roleLabel } from './labels';

export function composeGeneric(
  document: PDFKit.PDFDocument,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  for (const secao of [...input.sections].sort(
    (esquerda, direita) => esquerda.order - direita.order,
  )) {
    const itens: DefinitionItem[] = secao.fields
      .filter((campo) => !campo.hidden)
      .sort((esquerda, direita) => esquerda.order - direita.order)
      .map((campo) => {
        /* A largura é decidida pelo texto que vai ser impresso, e não pelo
           valor cru — um objeto respondido vira JSON longo, e medir o objeto
           daria "[object Object]". */
        const texto = formatAnswer(campo.value);
        return {
          label: campo.unit ? `${campo.label} (${campo.unit})` : campo.label,
          value: texto,
          full: texto.length > 60,
        };
      });
    if (itens.length === 0) continue;

    sectionTitle(document, secao.title, theme);
    if (secao.description) noteBlock(document, secao.description, theme);
    definitionCard(document, itens, theme);
  }

  if (input.evidence?.length) {
    sectionTitle(document, 'Evidências', theme, { espacoMinimo: 200 });
    photoGrid(
      document,
      input.evidence.map((item) => ({
        caption: item.caption,
        bytes: item.bytes,
        mimeType: item.mimeType,
        fileName: item.fileName,
      })),
      theme,
    );
  }

  if (input.signatures.length) {
    sectionTitle(document, 'Assinaturas', theme, { espacoMinimo: 130 });
    signatureBlock(
      document,
      [...input.signatures]
        .sort((esquerda, direita) => esquerda.order - direita.order)
        .map((assinatura) => ({
          label: assinatura.label,
          signerName: assinatura.signerName,
          roleLabel: roleLabel(assinatura.signerRole),
          credential: assinatura.professionalCredential,
          image: assinatura.signatureImage,
          imageMimeType: assinatura.signatureImageMimeType,
        })),
      theme,
    );
  }
}
