/**
 * A moldura da página: faixa de marca no topo, identificação no rodapé.
 *
 * ## Desenhada depois, não durante
 *
 * Cabeçalho e rodapé são pintados numa passada final sobre as páginas já
 * bufferizadas (`bufferPages`), e não no evento `pageAdded`. Dois motivos:
 *
 * - **"Página 3 de 7" exige saber o total.** Durante o fluxo ninguém sabe
 *   quantas páginas o documento terá; escrever "de 7" só é possível quando a
 *   última já existe.
 * - **Desenhar no meio do fluxo move o cursor.** Pintar o cabeçalho enquanto
 *   uma tabela transborda empurraria a linha seguinte para baixo do cabeçalho
 *   recém-desenhado, e a tabela continuaria no lugar errado.
 *
 * O espaço é reservado antes, pelas margens: o conteúdo nunca invade a área da
 * moldura porque ela não existe para o fluxo — existe só no fim.
 */
import type { DocumentEmitter } from './document-context';
import { FONTS, METRICS, brandGradient, type DocumentTheme } from './theme';

export interface FrameIdentity {
  /** "PMOC", "Ordem de Serviço" — o que o documento é. */
  readonly documentTitle: string;
  /** "PMOC-000023" — o número pelo qual ele é procurado. */
  readonly documentCode: string;
  readonly emitter?: DocumentEmitter;
  /** "Versão documental 1". */
  readonly revisionLabel?: string;
  /** Emissão já formatada no fuso de quem emite. */
  readonly issuedAtLabel?: string;
}

/** A largura útil entre as margens. */
export function contentWidth(document: PDFKit.PDFDocument): number {
  return (
    document.page.width -
    document.page.margins.left -
    document.page.margins.right
  );
}

/** Onde o conteúdo pode terminar antes de invadir o rodapé. */
export function contentBottom(document: PDFKit.PDFDocument): number {
  return document.page.height - document.page.margins.bottom;
}

/**
 * Garante espaço para o próximo bloco, abrindo página quando não houver.
 *
 * Devolve `true` quando quebrou — quem chama usa isso para repetir o cabeçalho
 * de uma tabela que continuou na página seguinte.
 */
export function ensureSpace(
  document: PDFKit.PDFDocument,
  needed: number,
): boolean {
  if (document.y + needed <= contentBottom(document)) return false;
  document.addPage();
  return true;
}

/**
 * Pinta a moldura em todas as páginas.
 *
 * Chamada uma vez, no fim, antes de `document.end()`.
 */
export function paintFrames(
  document: PDFKit.PDFDocument,
  identity: FrameIdentity,
  theme: DocumentTheme,
): void {
  const range = document.bufferedPageRange();
  const total = range.count;

  for (let indice = 0; indice < total; indice += 1) {
    document.switchToPage(range.start + indice);

    /**
     * A margem inferior é zerada enquanto a moldura é pintada.
     *
     * O rodapé é escrito **abaixo** da margem de conteúdo, que é justamente o
     * espaço reservado para ele. Só que `text()` interpreta uma escrita além da
     * margem inferior como "acabou a página" e **abre outra** — e como a
     * moldura é pintada em todas, cada rodapé criava uma página nova, que por
     * sua vez ganhava rodapé. O documento saía com o dobro de páginas, metade
     * em branco.
     *
     * Zerar a margem durante a pintura diz ao pdfkit que ali ainda é página.
     */
    const margemOriginal = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    paintHeader(document, identity, theme, indice === 0);
    paintFooter(document, identity, theme, indice + 1, total);
    document.page.margins.bottom = margemOriginal;
  }
}

/**
 * O cabeçalho.
 *
 * ## Duas formas, e o motivo
 *
 * Na primeira página é uma faixa grafite de altura inteira: logo, nome do
 * documento em branco, código em pílula e o timbre de quem emite. É o que faz
 * a folha parecer papel timbrado em vez de saída de formulário, e é a única
 * página onde alguém olha o cabeçalho procurando informação.
 *
 * Da segunda em diante repetir esse bloco é desperdício — num laudo de seis
 * páginas seriam seis faixas escuras dizendo a mesma coisa. Ali fica só o
 * necessário para identificar a folha solta que caiu da grampeadora: filete da
 * marca, nome do documento e código.
 */
function paintHeader(
  document: PDFKit.PDFDocument,
  identity: FrameIdentity,
  theme: DocumentTheme,
  primeira: boolean,
): void {
  const esquerda = METRICS.pageMargin;
  const direita = document.page.width - METRICS.pageMargin;
  const largura = direita - esquerda;

  if (!primeira) {
    paintCompactHeader(document, identity, theme, esquerda, direita, largura);
    return;
  }

  const alturaDaFaixa = METRICS.headerHeight - METRICS.headerGap;

  /**
   * O cabeçalho é branco.
   *
   * A faixa escura dava presença e cobrava caro por ela: reduzia o contraste
   * de tudo o que vinha depois, porque o olho chegava ao conteúdo vindo de uma
   * mancha de tinta. E logo de cliente costuma ser desenhado para fundo claro
   * — sobre o escuro, boa parte fica ilegível ou ganha um halo branco.
   *
   * O que segura o cabeçalho agora é o filete da marca na base, a hierarquia
   * de corpo entre o nome do documento e o timbre, e o espaço. Tabelas, blocos
   * de destaque e cabeçalhos de página seguintes continuam como estavam: o
   * escuro ali é funcional — separa a linha de cabeçalho dos dados — e não
   * compete com nada.
   */
  document.save();
  /**
   * A faixa de marca vai no **topo da folha**, acima do cabeçalho.
   *
   * Embaixo ela competia com o conteúdo logo abaixo — duas linhas coloridas
   * fortes na mesma região, a dela e o marcador da primeira seção. No topo ela
   * faz o que uma faixa de marca faz num papel timbrado: assina a folha antes
   * de qualquer coisa ser lida.
   */
  document
    .rect(0, 0, document.page.width, 4)
    .fill(brandGradient(document, theme));

  /* E o fim do cabeçalho é um fio quase invisível: a divisão precisa existir,
     não precisa ser vista. */
  /* De canto a canto, como a faixa do topo: um fio que para nas margens
     desenha uma caixa em volta do cabeçalho, e o que ele marca é o fim de uma
     região, não o contorno de um bloco. */
  document
    .moveTo(0, alturaDaFaixa)
    .lineTo(document.page.width, alturaDaFaixa)
    .lineWidth(0.5)
    .strokeColor(theme.hairline)
    .stroke();
  document.restore();
  /**
   * O logo do cliente vem **acima** do nome do documento, centrado nele.
   *
   * É a composição de papel timbrado: a marca de quem emite encabeça a folha e
   * o nome do documento vem logo abaixo, no mesmo eixo. Ao lado, o logo
   * disputava a linha com o título e o conjunto lia como dois elementos soltos
   * em vez de um bloco.
   *
   * O eixo é o da coluna do título, e não o da página: o timbre ocupa a
   * direita, e centrar na página jogaria o logo por cima dele.
   */
  /**
   * O bloco da esquerda: logo, nome do documento e código.
   *
   * Os três alinham pela **esquerda**, na margem. Centrados, cada um começava
   * num ponto diferente conforme a própria largura, e o bloco não tinha eixo:
   * a margem é o eixo que o resto da folha já usa.
   *
   * Tudo é medido antes de desenhar. O bloco crescia por acumulação e ninguém
   * conferia se ainda cabia na faixa — com logo, a pílula passava do filete.
   */
  const colunaDoTitulo = esquerda;
  const larguraDaColuna = largura * 0.54;

  /* O corpo do título cede até caber numa linha: `lineBreak: false` não
     impede o pdfkit de quebrar num espaço quando há `width`. */
  const temLogo = Boolean(identity.emitter?.logo);
  let corpoDoTitulo = temLogo ? 18 : 21;
  document.font(FONTS.bold);
  while (
    corpoDoTitulo > 11 &&
    document.fontSize(corpoDoTitulo).widthOfString(identity.documentTitle) >
      larguraDaColuna
  ) {
    corpoDoTitulo -= 1;
  }
  document.fontSize(corpoDoTitulo);
  /**
   * Duas larguras, e a diferença entre elas importa.
   *
   * `larguraDoTitulo` é quanto o texto mede — serve para o logo não passar do
   * nome do documento. Mas é `larguraDaColuna` que vai para o `text()`: passar
   * a largura medida deixava a caixa **exatamente** do tamanho do texto, e o
   * layout interno do pdfkit calcula quebra com regras um pouco diferentes de
   * `widthOfString`. Sem folga, "Relatório de Visita Técnica" quebrava na
   * última palavra e a segunda linha saía por trás da pílula.
   */
  const larguraDoTitulo = Math.min(
    document.widthOfString(identity.documentTitle),
    larguraDaColuna,
  );
  const alturaDoTitulo = document.currentLineHeight();

  const logo = identity.emitter?.logo
    ? medirLogo(identity.emitter.logo, larguraDoTitulo)
    : null;

  const ALTURA_DA_PILULA = 16;
  /* Respiro entre os três: colados, eles lêem como um carimbo só em vez de
     marca, nome e número. */
  const APOS_LOGO = 14;
  const ANTES_DA_PILULA = 11;

  const alturaDoBloco =
    (logo ? logo.altura + APOS_LOGO : 0) +
    alturaDoTitulo +
    ANTES_DA_PILULA +
    ALTURA_DA_PILULA;

  /**
   * O conteúdo respira dos dois lados, e mais embaixo que em cima.
   *
   * Encostado na faixa do topo ele parecia pendurado nela; encostado no fio de
   * baixo, empurrava o conteúdo da folha. A folga inferior é maior porque é
   * ela que separa o cabeçalho do documento — a superior separa de uma faixa
   * de 4 pontos.
   */
  const FOLGA_SUPERIOR = 26;
  const FOLGA_INFERIOR = 34;
  let y = Math.max(
    FOLGA_SUPERIOR,
    (alturaDaFaixa - FOLGA_INFERIOR + FOLGA_SUPERIOR - alturaDoBloco) / 2,
  );

  if (logo) {
    try {
      document.image(logo.bytes, colunaDoTitulo, y, {
        fit: [logo.largura, logo.altura],
      });
      y += logo.altura + APOS_LOGO;
    } catch {
      /* Logo ilegível não derruba o documento: o nome cobre a identificação. */
    }
  }

  document
    .font(FONTS.bold)
    .fontSize(corpoDoTitulo)
    .fillColor(theme.ink)
    .text(identity.documentTitle, colunaDoTitulo, y, {
      width: larguraDaColuna,
      lineBreak: false,
      ellipsis: true,
    });

  y += alturaDoTitulo + ANTES_DA_PILULA;

  pill(document, identity.documentCode, colunaDoTitulo, y, theme);

  /* O timbre fica à direita, alinhado à direita: é onde o olho procura quem
     emitiu, e é o que o documento impresso precisa provar. */
  const emitter = identity.emitter;
  if (emitter) {
    const linhas = [
      emitter.legalName,
      emitter.document,
      [emitter.cityState, emitter.phone].filter(Boolean).join(' · '),
      emitter.email,
    ].filter((linha): linha is string => Boolean(linha));

    const colunaX = esquerda + largura * 0.58;
    const colunaLargura = largura * 0.42;

    /**
     * O timbre é centrado na vertical da faixa, como o bloco da esquerda.
     *
     * Ancorado no topo, ele encostava no filete superior e ficava desalinhado
     * do nome do documento — duas colunas começando em alturas diferentes
     * dentro da mesma faixa. Medindo a altura antes, as duas partem do mesmo
     * eixo óptico.
     */
    const alturaDoNome = emitter.tradeName
      ? document.font(FONTS.bold).fontSize(10.5).currentLineHeight() + 3
      : 0;
    const alturaDaLinha = document
      .font(FONTS.regular)
      .fontSize(7.5)
      .currentLineHeight();
    const alturaDoTimbre = alturaDoNome + linhas.length * alturaDaLinha;

    let yDireita = Math.max(14, (alturaDaFaixa - alturaDoTimbre) / 2);

    if (emitter.tradeName) {
      document
        .font(FONTS.bold)
        .fontSize(10.5)
        .fillColor(theme.ink)
        .text(emitter.tradeName, colunaX, yDireita, {
          width: colunaLargura,
          align: 'right',
        });
      yDireita = document.y + 3;
    }

    document.font(FONTS.regular).fontSize(7.5).fillColor(theme.inkMuted);
    for (const linha of linhas) {
      document.text(linha, colunaX, yDireita, {
        width: colunaLargura,
        align: 'right',
      });
      yDireita = document.y;
    }
  }
}

/** Da segunda página em diante: o mínimo para identificar a folha. */
function paintCompactHeader(
  document: PDFKit.PDFDocument,
  identity: FrameIdentity,
  theme: DocumentTheme,
  esquerda: number,
  direita: number,
  largura: number,
): void {
  document.save();
  document
    .rect(0, 0, document.page.width, 3)
    .fill(brandGradient(document, theme));
  document.restore();

  /* A régua do compacto fica à mesma distância do conteúdo que o fio da
     primeira página: assim o texto começa no mesmo lugar em toda folha. */
  const linhaY = METRICS.compactHeaderHeight - METRICS.headerGap;
  const y = linhaY - 15;
  const rotulo = [identity.emitter?.tradeName, identity.documentTitle]
    .filter(Boolean)
    .join('  ·  ');

  document
    .font(FONTS.bold)
    .fontSize(8.5)
    .fillColor(theme.ink)
    .text(rotulo, esquerda, y, {
      width: largura * 0.7,
      lineBreak: false,
      ellipsis: true,
    });

  document
    .font(FONTS.bold)
    .fontSize(8.5)
    .fillColor(theme.accent)
    .text(identity.documentCode, esquerda + largura * 0.7, y, {
      width: largura * 0.3,
      align: 'right',
      lineBreak: false,
    });

  document
    .save()
    .moveTo(0, linhaY)
    .lineTo(document.page.width, linhaY)
    .lineWidth(0.5)
    .strokeColor(theme.border)
    .stroke()
    .restore();
}

/**
 * O código do documento numa pílula com o degradê.
 *
 * Um código em texto solto some no meio do timbre. Na pílula ele vira o
 * segundo elemento que se lê depois do nome do documento — que é a ordem em
 * que alguém procura um papel específico numa pasta.
 */
function pill(
  document: PDFKit.PDFDocument,
  texto: string,
  x: number,
  y: number,
  theme: DocumentTheme,
): void {
  document.font(FONTS.bold).fontSize(8.5);
  const larguraDoTexto = document.widthOfString(texto);
  const padding = 9;
  const largura = larguraDoTexto + padding * 2;
  const altura = 16;

  document
    .save()
    .roundedRect(x, y, largura, altura, altura / 2)
    .fill(brandGradient(document, theme))
    .restore();

  /* Centrado na vertical pela altura real da linha: o deslocamento fixo de
     4,5 valia para a métrica da Helvetica e deixou o texto colado na base
     quando a fonte mudou. */
  const alturaDaLinha = document.currentLineHeight();
  document
    .fillColor('#FFFFFF')
    .text(texto, x + padding, y + (altura - alturaDaLinha) / 2, {
      lineBreak: false,
    });
}

function paintFooter(
  document: PDFKit.PDFDocument,
  identity: FrameIdentity,
  theme: DocumentTheme,
  pagina: number,
  total: number,
): void {
  const esquerda = METRICS.pageMargin;
  const direita = document.page.width - METRICS.pageMargin;
  const largura = direita - esquerda;
  const base = document.page.height - METRICS.footerHeight + 8;

  document
    .save()
    .moveTo(esquerda, base)
    .lineTo(direita, base)
    .lineWidth(0.5)
    .strokeColor(theme.border)
    .stroke()
    .restore();

  const emitter = identity.emitter;
  const identificacao = [
    emitter?.tradeName ?? emitter?.legalName,
    emitter?.phone,
    emitter?.email,
    identity.documentCode,
    identity.revisionLabel,
    identity.issuedAtLabel,
  ]
    .filter(Boolean)
    .join(' · ');

  const numeracao = `Página ${pagina} de ${total}`;
  const larguraDaNumeracao = 90;

  document
    .font(FONTS.regular)
    .fontSize(7)
    .fillColor(theme.inkFaint)
    .text(identificacao, esquerda, base + 6, {
      width: largura - larguraDaNumeracao - 8,
      lineBreak: false,
      ellipsis: true,
    });

  document
    .font(FONTS.regular)
    .fontSize(7)
    .fillColor(theme.inkMuted)
    .text(numeracao, direita - larguraDaNumeracao, base + 6, {
      width: larguraDaNumeracao,
      align: 'right',
      lineBreak: false,
    });
}

/**
 * O logo medido: bytes e o tamanho que vai ocupar.
 *
 * `fit` do pdfkit preserva a proporção e não informa o resultado, que é o que
 * falta para centrar. As dimensões saem do cabeçalho do arquivo — `IHDR` no
 * PNG, marcador `SOFn` no JPEG.
 *
 * Logo que não soubermos medir ocupa a caixa inteira e fica alinhado à
 * esquerda: degradação aceitável para um formato desconhecido.
 */
function medirLogo(
  bytes: Buffer,
  larguraMaxima: number,
): { bytes: Buffer; largura: number; altura: number } {
  const ALTURA_ALVO = 30;
  const dimensoes = dimensoesDaImagem(bytes);
  if (!dimensoes) {
    return { bytes, largura: larguraMaxima, altura: ALTURA_ALVO };
  }

  const escala = Math.min(
    ALTURA_ALVO / dimensoes.altura,
    larguraMaxima / dimensoes.largura,
  );
  return {
    bytes,
    largura: dimensoes.largura * escala,
    altura: dimensoes.altura * escala,
  };
}

function dimensoesDaImagem(
  bytes: Buffer,
): { largura: number; altura: number } | null {
  /* PNG: assinatura de 8 bytes, depois o IHDR com largura e altura. */
  if (
    bytes.length > 24 &&
    bytes.readUInt32BE(0) === 0x89504e47 &&
    bytes.toString('latin1', 12, 16) === 'IHDR'
  ) {
    return { largura: bytes.readUInt32BE(16), altura: bytes.readUInt32BE(20) };
  }

  /* JPEG: percorre os marcadores até um SOFn, que carrega as dimensões. */
  if (bytes.length > 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let posicao = 2;
    while (posicao + 9 < bytes.length) {
      if (bytes[posicao] !== 0xff) {
        posicao += 1;
        continue;
      }
      const marcador = bytes[posicao + 1]!;
      /* SOF0..SOF3 e SOF5..SOF15; DHT/DAC/RST não trazem dimensão. */
      const ehSof =
        marcador >= 0xc0 &&
        marcador <= 0xcf &&
        marcador !== 0xc4 &&
        marcador !== 0xc8 &&
        marcador !== 0xcc;
      if (ehSof) {
        return {
          altura: bytes.readUInt16BE(posicao + 5),
          largura: bytes.readUInt16BE(posicao + 7),
        };
      }
      posicao += 2 + bytes.readUInt16BE(posicao + 2);
    }
  }

  return null;
}
