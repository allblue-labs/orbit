/**
 * Evidência fotográfica e assinatura — os dois blocos que carregam imagem.
 *
 * Ficam separados dos demais porque imagem tem um problema que texto não tem:
 * o arquivo pode estar corrompido, ter formato que o desenhador não abre, ou
 * simplesmente não ter vindo. Um documento que morre porque uma foto veio
 * truncada é pior que um documento com uma foto faltando — o primeiro some, o
 * segundo é entregue e a falta é visível.
 */
import { contentWidth, ensureSpace } from './page-frame';
import { FONTS, METRICS, type DocumentTheme } from './theme';

type Doc = PDFKit.PDFDocument;

export interface PhotoItem {
  readonly caption?: string | null;
  readonly bytes?: Buffer;
  readonly mimeType: string;
  readonly fileName: string;
}

const IMAGEM_SUPORTADA = /^image\/(png|jpe?g)$/i;

/**
 * Grade de evidências, duas por linha.
 *
 * Duas por linha e não quatro: o que se registra em campo é o estado de um
 * equipamento, e uma miniatura de 4 cm não prova nada — quem recebe o
 * documento precisa conseguir ver o filtro sujo.
 */
export function photoGrid(
  document: Doc,
  fotos: readonly PhotoItem[],
  theme: DocumentTheme,
): void {
  const renderizaveis = fotos.filter(
    (foto) => foto.bytes && IMAGEM_SUPORTADA.test(foto.mimeType),
  );
  if (renderizaveis.length === 0) return;

  const largura = contentWidth(document);
  const esquerda = document.page.margins.left;
  const colunas = 2;
  const larguraDoCartao = (largura - METRICS.gutter) / colunas;
  const alturaDaImagem = 150;
  const padding = 8;
  const alturaDaLegenda = 22;
  const alturaDoCartao = alturaDaImagem + padding * 2 + alturaDaLegenda;

  for (let indice = 0; indice < renderizaveis.length; indice += colunas) {
    ensureSpace(document, alturaDoCartao + 10);
    const topo = document.y;

    for (let coluna = 0; coluna < colunas; coluna += 1) {
      const foto = renderizaveis[indice + coluna];
      if (!foto) break;

      const x = esquerda + coluna * (larguraDoCartao + METRICS.gutter);

      document
        .save()
        .roundedRect(x, topo, larguraDoCartao, alturaDoCartao, METRICS.radius)
        .fillColor(theme.surface)
        .fill()
        .roundedRect(x, topo, larguraDoCartao, alturaDoCartao, METRICS.radius)
        .lineWidth(0.5)
        .strokeColor(theme.border)
        .stroke()
        .restore();

      try {
        document.image(foto.bytes!, x + padding, topo + padding, {
          fit: [larguraDoCartao - padding * 2, alturaDaImagem],
          align: 'center',
          valign: 'center',
        });
      } catch {
        /* Arquivo ilegível: o cartão fica, dizendo o que deveria estar ali. */
        document
          .font(FONTS.regular)
          .fontSize(8)
          .fillColor(theme.inkFaint)
          .text('Imagem indisponível', x + padding, topo + alturaDaImagem / 2, {
            width: larguraDoCartao - padding * 2,
            align: 'center',
          });
      }

      document
        .font(FONTS.regular)
        .fontSize(7.5)
        .fillColor(theme.inkMuted)
        .text(
          foto.caption ?? foto.fileName,
          x + padding,
          topo + padding + alturaDaImagem + 6,
          {
            width: larguraDoCartao - padding * 2,
            align: 'center',
            lineBreak: false,
            ellipsis: true,
          },
        );
    }

    document.y = topo + alturaDoCartao + METRICS.gutter;
  }

  document.x = esquerda;
}

export interface SignatureItem {
  readonly label: string;
  readonly signerName?: string;
  /** "Responsável técnico", já em português — nunca o enum do banco. */
  readonly roleLabel?: string;
  readonly credential?: string;
  readonly signedAtLabel?: string;
  readonly image?: Buffer;
  readonly imageMimeType?: string;
}

/**
 * Assinaturas, duas por linha.
 *
 * A linha de assinatura é desenhada **sempre**, com ou sem imagem: um campo de
 * assinatura vazio num documento impresso é onde se assina à caneta, e é assim
 * que metade dos PMOCs ainda é fechada em campo.
 */
export function signatureBlock(
  document: Doc,
  assinaturas: readonly SignatureItem[],
  theme: DocumentTheme,
): void {
  if (assinaturas.length === 0) return;

  const largura = contentWidth(document);
  const esquerda = document.page.margins.left;
  const colunas = assinaturas.length === 1 ? 1 : 2;
  const larguraDoBloco =
    colunas === 1 ? largura * 0.6 : (largura - METRICS.gutter) / 2;
  const alturaDaAssinatura = 46;
  const alturaDoBloco = alturaDaAssinatura + 52;

  for (let indice = 0; indice < assinaturas.length; indice += colunas) {
    ensureSpace(document, alturaDoBloco + 10);
    const topo = document.y;

    for (let coluna = 0; coluna < colunas; coluna += 1) {
      const assinatura = assinaturas[indice + coluna];
      if (!assinatura) break;

      const x = esquerda + coluna * (larguraDoBloco + METRICS.gutter);

      if (
        assinatura.image &&
        IMAGEM_SUPORTADA.test(assinatura.imageMimeType ?? '')
      ) {
        try {
          document.image(assinatura.image, x, topo, {
            fit: [larguraDoBloco * 0.7, alturaDaAssinatura],
          });
        } catch {
          /* Assinatura ilegível vira linha em branco, não erro. */
        }
      }

      const linhaY = topo + alturaDaAssinatura + 4;
      document
        .save()
        .moveTo(x, linhaY)
        .lineTo(x + larguraDoBloco, linhaY)
        .lineWidth(0.7)
        .strokeColor(theme.inkMuted)
        .stroke()
        .restore();

      document
        .font(FONTS.bold)
        .fontSize(9)
        .fillColor(theme.ink)
        .text(assinatura.signerName ?? assinatura.label, x, linhaY + 6, {
          width: larguraDoBloco,
          lineBreak: false,
          ellipsis: true,
        });

      const detalhes = [
        assinatura.roleLabel,
        assinatura.credential,
        assinatura.signedAtLabel,
      ]
        .filter(Boolean)
        .join(' · ');

      if (detalhes) {
        document
          .font(FONTS.regular)
          .fontSize(7.5)
          .fillColor(theme.inkMuted)
          .text(detalhes, x, document.y + 1, { width: larguraDoBloco });
      }
    }

    document.y = topo + alturaDoBloco;
  }

  document.x = esquerda;
}
