/**
 * Os blocos com que um documento premium é montado.
 *
 * Cada função desenha **um** bloco a partir do cursor atual e deixa o cursor
 * abaixo dele. Nenhuma decide conteúdo: recebem o que mostrar e cuidam só de
 * medida, quebra e tinta.
 *
 * ## A quebra de página mora aqui
 *
 * É o ponto mais delicado do documento impresso. Uma tabela de equipamentos
 * com quarenta linhas não cabe numa página, e cortá-la em qualquer lugar
 * produz uma segunda página que começa com números soltos, sem dizer de que
 * coluna são. Por isso `table` mede linha a linha e, ao virar a página,
 * **repete o cabeçalho** marcando que aquilo é continuação.
 */
import { contentBottom, contentWidth, ensureSpace } from './page-frame';
import {
  FONTS,
  METRICS,
  brandGradientVertical,
  shellGradient,
  type DocumentTheme,
} from './theme';

type Doc = PDFKit.PDFDocument;

/**
 * O ritmo vertical do documento.
 *
 * ## Por que o espaço acima do título é o maior de todos
 *
 * É a lei da proximidade: o que está perto pertence junto. Com o mesmo espaço
 * acima e abaixo, o título flutua entre dois blocos e o leitor precisa ler o
 * texto para descobrir a qual deles ele se refere — era o caso, com 14pt
 * antes e 10 depois.
 *
 * Três distâncias, e a diferença entre elas é o que faz a página ter
 * estrutura sem precisar de caixa, linha ou cor:
 *
 * ```
 * ENTRE_SECOES  28  ── separa assuntos
 * ENTRE_BLOCOS  12  ── separa peças do mesmo assunto
 * APOS_TITULO    7  ── cola o título no que ele nomeia
 * ```
 */
const RITMO = {
  /** Somado ao que o bloco anterior deixou (`ENTRE_BLOCOS`). */
  antesDaSecao: 16,
  aposTitulo: 7,
  entreBlocos: 12,
} as const;

/* ------------------------------------------------------------------ */
/* Títulos                                                             */
/* ------------------------------------------------------------------ */

/**
 * Título de seção.
 *
 * Exige espaço para o título **mais** um primeiro pedaço de conteúdo: um
 * título sozinho no pé da página é o defeito clássico do relatório impresso,
 * e quem lê vira a folha sem saber o que está começando.
 *
 * O padrão reserva o título e cerca de quatro linhas — o suficiente para o
 * começo de um quadro de texto ou as duas primeiras linhas de uma tabela.
 * Era 72, que passava o título e deixava o conteúdo para a página seguinte
 * justamente no caso que a folga existe para evitar.
 */
export function sectionTitle(
  document: Doc,
  texto: string,
  theme: DocumentTheme,
  options: { readonly espacoMinimo?: number } = {},
): void {
  /* O respiro que separa assuntos. No topo da página não entra: a margem já
     é o espaço, e somar os dois deixaria a primeira seção afundada. */
  if (document.y > document.page.margins.top + 1) {
    document.y += RITMO.antesDaSecao;
  }

  ensureSpace(document, options.espacoMinimo ?? 112);

  /**
   * Marcador de degradê à esquerda, título em grafite.
   *
   * O título colorido competia com o próprio conteúdo: numa folha com seis
   * seções, seis linhas de texto azul em corpo grande puxam mais atenção que
   * os dados. O grafite devolve o peso ao texto e o marcador mantém a marca
   * presente — é o mesmo recurso da barra dos blocos de destaque, na mesma
   * largura, o que faz o documento parecer um sistema e não uma coleção de
   * tratamentos.
   */
  const esquerdaDoTitulo = document.page.margins.left;
  const yDoTitulo = document.y;

  document
    .save()
    .roundedRect(esquerdaDoTitulo, yDoTitulo + 1.5, 3, 13, 1.5)
    .fill(brandGradientVertical(document, yDoTitulo, 14, theme))
    .restore();

  document
    .font(FONTS.bold)
    .fontSize(12)
    .fillColor(theme.ink)
    .text(texto, esquerdaDoTitulo + 10, yDoTitulo, {
      width: contentWidth(document) - 10,
    });

  const y = document.y + 4;
  document
    .save()
    .moveTo(esquerdaDoTitulo, y)
    .lineTo(document.page.width - document.page.margins.right, y)
    .lineWidth(0.6)
    .strokeColor(theme.border)
    .stroke()
    .restore();

  document.x = esquerdaDoTitulo;
  document.y = y + RITMO.aposTitulo;
}

/* ------------------------------------------------------------------ */
/* Cartão de definições                                                */
/* ------------------------------------------------------------------ */

export interface DefinitionItem {
  readonly label: string;
  readonly value?: string | null;
  /** Ocupa a linha inteira — endereço, escopo, observação curta. */
  readonly full?: boolean;
}

/**
 * Pares rótulo/valor em duas colunas, dentro de um cartão.
 *
 * Duas colunas porque é a densidade que um documento de uma página suporta sem
 * virar formulário. O item marcado como `full` atravessa as duas — endereço
 * quebrado em duas colunas fica ilegível.
 *
 * O cartão é medido **antes** de ser desenhado: a moldura precisa saber a
 * altura final, e descobrir isso desenhando exigiria apagar e refazer.
 */
export function definitionCard(
  document: Doc,
  itens: readonly DefinitionItem[],
  theme: DocumentTheme,
): void {
  const visiveis = itens.filter((item) => item.value);
  if (visiveis.length === 0) return;

  const largura = contentWidth(document);
  /**
   * Sem caixa: os pares assentam no branco do papel.
   *
   * A moldura cinza com borda em volta de cada grupo é o que fazia a folha
   * parecer formulário preenchido — seis caixas empilhadas numa página, cada
   * uma competindo com a seguinte. O título de seção já delimita o grupo; a
   * caixa repetia essa delimitação e cobrava respiro por isso.
   *
   * O que separa as linhas agora é uma régua de meio ponto, que o olho segue
   * sem perceber que está lá.
   */
  const colunaLargura = (largura - METRICS.gutter) / 2;

  /* Medição: cada item vira uma altura, e os de meia largura são emparelhados
     dois a dois — a linha vale pela maior das duas alturas. */
  const medidos = visiveis.map((item) => {
    const larguraDoTexto = item.full ? largura : colunaLargura;
    document.font(FONTS.regular).fontSize(10);
    const alturaDoValor = document.heightOfString(item.value ?? '', {
      width: larguraDoTexto,
    });
    return { item, larguraDoTexto, altura: 12 + alturaDoValor };
  });

  const linhas: (typeof medidos)[] = [];
  let pendente: typeof medidos = [];
  for (const medido of medidos) {
    if (medido.item.full) {
      if (pendente.length) {
        linhas.push(pendente);
        pendente = [];
      }
      linhas.push([medido]);
      continue;
    }
    pendente.push(medido);
    if (pendente.length === 2) {
      linhas.push(pendente);
      pendente = [];
    }
  }
  if (pendente.length) linhas.push(pendente);

  const espacoEntreLinhas = 13;
  /* O espaço entre linhas entra entre elas, não depois da última: somá-lo ao
     fim empilharia com o respiro de seção e abriria um vão de 40pt onde
     deviam ser 28. */
  const alturaTotal =
    linhas.reduce(
      (total, linha) =>
        total +
        Math.max(...linha.map((medido) => medido.altura)) +
        espacoEntreLinhas,
      0,
    ) - espacoEntreLinhas;

  ensureSpace(document, alturaTotal + 8);

  const topo = document.y;
  const esquerda = document.page.margins.left;

  let y = topo;
  for (const [indiceDaLinha, linha] of linhas.entries()) {
    /* Régua entre linhas, nunca antes da primeira nem depois da última: ela
       separa pares, e não emoldura o grupo. */
    if (indiceDaLinha > 0) {
      document
        .save()
        .moveTo(esquerda, y - espacoEntreLinhas / 2 - 1)
        .lineTo(esquerda + largura, y - espacoEntreLinhas / 2 - 1)
        .lineWidth(0.5)
        .strokeColor(theme.border)
        .stroke()
        .restore();
    }

    let x = esquerda;
    for (const medido of linha) {
      document
        .font(FONTS.bold)
        /* 7pt, e não 6.5: meio ponto num rótulo em caixa alta é a diferença
           entre ler e decifrar quando a folha sai de uma impressora de
           escritório. */
        .fontSize(7.5)
        .fillColor(theme.inkFaint)
        .text(medido.item.label.toUpperCase(), x, y, {
          width: medido.larguraDoTexto,
          characterSpacing: 0.7,
          lineBreak: false,
          ellipsis: true,
        });
      document
        .font(FONTS.regular)
        .fontSize(10)
        .fillColor(theme.ink)
        .text(medido.item.value ?? '', x, y + 11, {
          width: medido.larguraDoTexto,
        });
      x += colunaLargura + METRICS.gutter;
    }
    y += Math.max(...linha.map((medido) => medido.altura)) + espacoEntreLinhas;
  }

  document.y = topo + alturaTotal + RITMO.entreBlocos;
  document.x = esquerda;
}

/* ------------------------------------------------------------------ */
/* Tabela                                                              */
/* ------------------------------------------------------------------ */

export interface TableColumn {
  readonly header: string;
  /** Peso relativo da largura; a soma é normalizada. */
  readonly weight: number;
  readonly align?: 'left' | 'center' | 'right';
  readonly mono?: boolean;
}

/**
 * Tabela com cabeçalho que se repete a cada página.
 *
 * ## Por que medir antes de desenhar cada linha
 *
 * Uma célula com texto longo ocupa duas ou três linhas, e só depois de medir
 * dá para saber se a linha ainda cabe. Desenhar primeiro e descobrir depois
 * produziria a metade de uma linha no pé de uma página e a outra metade no
 * topo da seguinte.
 *
 * ## O cabeçalho repetido diz que é continuação
 *
 * Sem isso, a página seguinte começa com uma tabela que parece nova. O sufixo
 * é discreto de propósito: quem está lendo em sequência não precisa dele, e
 * quem pegou a folha solta precisa.
 */
export function table(
  document: Doc,
  columns: readonly TableColumn[],
  rows: readonly (readonly (string | null | undefined)[])[],
  theme: DocumentTheme,
  options: { readonly continuationLabel?: string } = {},
): void {
  if (rows.length === 0) return;

  const largura = contentWidth(document);
  const esquerda = document.page.margins.left;
  const pesoTotal = columns.reduce((total, coluna) => total + coluna.weight, 0);
  const larguras = columns.map(
    (coluna) => (coluna.weight / pesoTotal) * largura,
  );
  const paddingX = 6;
  const paddingY = 5;

  const desenharCabecalho = (continuacao: boolean): void => {
    /**
     * O aviso de continuação é uma legenda **acima** da tabela.
     *
     * Antes ele era concatenado ao texto da primeira coluna, o que produzia
     * "ITEM (CONTINUAÇÃO)" dentro de uma célula dimensionada para a palavra
     * "Item": o texto estourava a largura e desalinhava o cabeçalho inteiro na
     * segunda página. Uma informação sobre a tabela não cabe numa célula da
     * tabela.
     */
    if (continuacao && options.continuationLabel) {
      document
        .font(FONTS.regular)
        .fontSize(7)
        .fillColor(theme.inkFaint)
        .text(options.continuationLabel, esquerda, document.y, {
          width: largura,
          characterSpacing: 0.2,
        });
      document.y += 3;
    }

    const alturaDoCabecalho = 21;
    const topo = document.y;

    document
      .save()
      .roundedRect(esquerda, topo, largura, alturaDoCabecalho, METRICS.radius)
      /* O canto de baixo volta a ser reto: a faixa encosta na primeira linha
         de dados, e cantos arredondados ali deixariam um vinco branco. */
      .rect(
        esquerda,
        topo + alturaDoCabecalho - METRICS.radius,
        largura,
        METRICS.radius,
      )
      .fill(shellGradient(document, theme))
      .restore();

    let x = esquerda;
    columns.forEach((coluna, indice) => {
      const texto = coluna.header;
      document
        .font(FONTS.bold)
        .fontSize(7)
        .fillColor(theme.onShell)
        .text(texto.toUpperCase(), x + paddingX, topo + 7, {
          width: larguras[indice]! - paddingX * 2,
          align: coluna.align ?? 'left',
          characterSpacing: 0.3,
          lineBreak: false,
          ellipsis: true,
        });
      x += larguras[indice]!;
    });

    document.y = topo + alturaDoCabecalho;
  };

  ensureSpace(document, 20 + 26);
  desenharCabecalho(false);

  rows.forEach((linha, indiceDaLinha) => {
    /* Medição antes de escrever: a altura da linha é a da célula mais alta. */
    const alturas = columns.map((coluna, indice) => {
      document.font(coluna.mono ? FONTS.mono : FONTS.regular).fontSize(8.5);
      return document.heightOfString(String(linha[indice] ?? '—'), {
        width: larguras[indice]! - paddingX * 2,
      });
    });
    const alturaDaLinha = Math.max(...alturas) + paddingY * 2;

    if (document.y + alturaDaLinha > contentBottom(document)) {
      document.addPage();
      desenharCabecalho(true);
    }

    const topo = document.y;

    /* Zebra discreta: ajuda o olho a atravessar linhas largas sem virar
       listrado de planilha. */
    if (indiceDaLinha % 2 === 1) {
      document
        .save()
        .rect(esquerda, topo, largura, alturaDaLinha)
        .fillColor(theme.surface)
        .fill()
        .restore();
    }

    let x = esquerda;
    columns.forEach((coluna, indice) => {
      document
        .font(coluna.mono ? FONTS.mono : FONTS.regular)
        .fontSize(8.5)
        .fillColor(theme.ink)
        .text(String(linha[indice] ?? '—'), x + paddingX, topo + paddingY, {
          width: larguras[indice]! - paddingX * 2,
          align: coluna.align ?? 'left',
        });
      x += larguras[indice]!;
    });

    document
      .save()
      .moveTo(esquerda, topo + alturaDaLinha)
      .lineTo(esquerda + largura, topo + alturaDaLinha)
      .lineWidth(0.4)
      .strokeColor(theme.border)
      .stroke()
      .restore();

    document.y = topo + alturaDaLinha;
  });

  document.y += RITMO.entreBlocos;
  document.x = esquerda;
}

/* ------------------------------------------------------------------ */
/* Blocos de texto                                                     */
/* ------------------------------------------------------------------ */

/** Parágrafo dentro de um quadro — observações, conclusão, nota legal. */
export function noteBlock(
  document: Doc,
  texto: string,
  theme: DocumentTheme,
  options: { readonly title?: string } = {},
): void {
  const largura = contentWidth(document);
  const padding = 10;

  document.font(FONTS.regular).fontSize(9.5);
  const alturaDoTexto = document.heightOfString(texto, {
    width: largura - padding * 2,
  });
  const alturaDoTitulo = options.title ? 12 : 0;
  const alturaTotal = alturaDoTexto + alturaDoTitulo + padding * 2;

  ensureSpace(document, alturaTotal + 8);

  const topo = document.y;
  const esquerda = document.page.margins.left;

  /* Sem borda: o fundo já separa o texto do papel, e o contorno em volta
     dele era o que dava ao bloco cara de campo de formulário. */
  document
    .save()
    .roundedRect(esquerda, topo, largura, alturaTotal, METRICS.radius)
    .fillColor(theme.surface)
    .fill()
    .restore();

  if (options.title) {
    document
      .font(FONTS.bold)
      .fontSize(7)
      .fillColor(theme.inkFaint)
      .text(options.title.toUpperCase(), esquerda + padding, topo + padding, {
        width: largura - padding * 2,
        characterSpacing: 0.4,
      });
  }

  document
    .font(FONTS.regular)
    .fontSize(9.5)
    .fillColor(theme.ink)
    .text(texto, esquerda + padding, topo + padding + alturaDoTitulo, {
      width: largura - padding * 2,
    });

  document.y = topo + alturaTotal + RITMO.entreBlocos;
  document.x = esquerda;
}

/** Legenda de um grupo dentro de uma seção — "Unidade evaporadora". */
export function groupLabel(
  document: Doc,
  texto: string,
  theme: DocumentTheme,
): void {
  ensureSpace(document, 56);
  document
    .font(FONTS.bold)
    .fontSize(9.5)
    .fillColor(theme.ink)
    .text(texto, { width: contentWidth(document) });
  document.y += 4;
  document.x = document.page.margins.left;
}

/* ------------------------------------------------------------------ */
/* Lista de verificação                                                */
/* ------------------------------------------------------------------ */

export interface CheckItem {
  readonly label: string;
  /** `null` quando o item não foi respondido — diferente de respondido "não". */
  readonly checked: boolean | null;
  readonly note?: string | null;
}

/**
 * Itens de verificação com caixa marcada, em duas colunas.
 *
 * ## Por que caixa e não a palavra "Sim"
 *
 * Quem confere um relatório de visita procura o que **não** foi feito, e
 * procura varrendo a margem. Uma coluna de caixas dá isso num relance; uma
 * coluna de "Sim"/"Não" obriga a ler cada linha. É o mesmo dado com custo de
 * leitura diferente.
 *
 * ## Três estados, não dois
 *
 * Marcado, não marcado e **sem resposta** são coisas diferentes. Imprimir o
 * item não respondido como se fosse recusado inventa um fato que ninguém
 * registrou — e num documento assinado isso é grave. O não respondido sai com
 * a caixa tracejada e um traço no lugar da marca.
 *
 * ## A observação vai junto
 *
 * Uma tabela com coluna de observação fica quase toda vazia, porque a maioria
 * dos itens não tem nada a dizer. Aqui a observação entra sob o rótulo, em
 * corpo menor, só quando existe: mesma informação, sem a coluna deserta.
 */
export function checkList(
  document: Doc,
  itens: readonly CheckItem[],
  theme: DocumentTheme,
): void {
  if (itens.length === 0) return;

  const largura = contentWidth(document);
  const colunaLargura = (largura - METRICS.gutter) / 2;
  const caixa = 8;
  const recuo = caixa + 7;
  const larguraDoTexto = colunaLargura - recuo;

  const medidos = itens.map((item) => {
    document.font(FONTS.regular).fontSize(9);
    let altura = document.heightOfString(item.label, {
      width: larguraDoTexto,
    });
    if (item.note) {
      document.font(FONTS.regular).fontSize(7.5);
      altura +=
        2 +
        document.heightOfString(item.note, {
          width: larguraDoTexto,
        });
    }
    return { item, altura: Math.max(altura, caixa + 2) };
  });

  const esquerda = document.page.margins.left;

  for (let indice = 0; indice < medidos.length; indice += 2) {
    const par = medidos.slice(indice, indice + 2);
    const alturaDaLinha = Math.max(...par.map((medido) => medido.altura)) + 7;

    ensureSpace(document, alturaDaLinha);
    const topo = document.y;

    par.forEach((medido, coluna) => {
      const x = esquerda + coluna * (colunaLargura + METRICS.gutter);
      desenharCaixa(document, x, topo + 1, caixa, medido.item.checked, theme);

      document
        .font(FONTS.regular)
        .fontSize(9)
        .fillColor(theme.ink)
        .text(medido.item.label, x + recuo, topo, { width: larguraDoTexto });

      if (medido.item.note) {
        document
          .font(FONTS.regular)
          .fontSize(7.5)
          .fillColor(theme.inkMuted)
          .text(medido.item.note, x + recuo, document.y + 1, {
            width: larguraDoTexto,
          });
      }
    });

    document.y = topo + alturaDaLinha;
    document.x = esquerda;
  }

  document.y += RITMO.entreBlocos - 6;
}

function desenharCaixa(
  document: Doc,
  x: number,
  y: number,
  lado: number,
  marcado: boolean | null,
  theme: DocumentTheme,
): void {
  document.save().lineWidth(0.8);

  if (marcado === null) {
    /* Tracejada: ninguém respondeu, e a folha não deve sugerir que alguém
       respondeu. */
    document
      .dash(1.5, { space: 1.5 })
      .rect(x, y, lado, lado)
      .strokeColor(theme.border)
      .stroke()
      .undash();
    document
      .moveTo(x + 2, y + lado / 2)
      .lineTo(x + lado - 2, y + lado / 2)
      .strokeColor(theme.inkFaint)
      .stroke();
    document.restore();
    return;
  }

  document
    .rect(x, y, lado, lado)
    .strokeColor(marcado ? theme.accent : theme.border)
    .stroke();

  if (marcado) {
    document
      .moveTo(x + 1.8, y + lado / 2)
      .lineTo(x + lado / 2 - 0.6, y + lado - 2.2)
      .lineTo(x + lado - 1.6, y + 2)
      .lineWidth(1.2)
      .strokeColor(theme.accent)
      .stroke();
  }

  document.restore();
}

/* ------------------------------------------------------------------ */
/* Valor em destaque                                                   */
/* ------------------------------------------------------------------ */

/**
 * O valor principal do documento, com o extenso embaixo.
 *
 * ## Por que não é mais um par rótulo/valor
 *
 * Num recibo o valor **é** o documento. Impresso em corpo 9 no meio de uma
 * grade, ele fica do mesmo tamanho do número do telefone, e quem confere
 * precisa procurar. Aqui ele ocupa a largura toda, num corpo que se lê de
 * longe, com a faixa de acento à esquerda marcando onde olhar.
 *
 * O extenso vem logo abaixo, e não em outro canto da folha: as duas formas do
 * mesmo número conferem uma à outra, e separá-las destrói justamente a
 * conferência que o extenso existe para permitir.
 */
export function amountBlock(
  document: Doc,
  amount: string,
  theme: DocumentTheme,
  options: { readonly label?: string; readonly inWords?: string } = {},
): void {
  const largura = contentWidth(document);
  const padding = 14;
  const larguraDoTexto = largura - padding * 2 - 6;

  const alturaDoRotulo = options.label ? 12 : 0;
  document.font(FONTS.bold).fontSize(20);
  const alturaDoValor = document.heightOfString(amount, {
    width: larguraDoTexto,
  });
  let alturaDoExtenso = 0;
  if (options.inWords) {
    document.font(FONTS.regular).fontSize(9);
    alturaDoExtenso =
      4 + document.heightOfString(options.inWords, { width: larguraDoTexto });
  }
  const alturaTotal =
    alturaDoRotulo + alturaDoValor + alturaDoExtenso + padding * 2;

  ensureSpace(document, alturaTotal + 8);

  const topo = document.y;
  const esquerda = document.page.margins.left;

  document
    .save()
    .roundedRect(esquerda, topo, largura, alturaTotal, METRICS.radius)
    .fillColor(theme.surfaceStrong)
    .fill()
    /* A faixa é desenhada por cima do fundo e não como borda: uma borda de
       6pt arredondada deixaria o canto grosso e o miolo desalinhado. */
    .rect(esquerda, topo, 4, alturaTotal)
    .fill(brandGradientVertical(document, topo, alturaTotal, theme))
    .restore();

  let y = topo + padding;

  if (options.label) {
    document
      .font(FONTS.bold)
      .fontSize(7)
      .fillColor(theme.inkFaint)
      .text(options.label.toUpperCase(), esquerda + padding + 6, y, {
        width: larguraDoTexto,
        characterSpacing: 0.4,
      });
    y += alturaDoRotulo;
  }

  document
    .font(FONTS.bold)
    .fontSize(20)
    .fillColor(theme.ink)
    .text(amount, esquerda + padding + 6, y, { width: larguraDoTexto });

  if (options.inWords) {
    document
      .font(FONTS.regular)
      .fontSize(9)
      .fillColor(theme.inkMuted)
      .text(options.inWords, esquerda + padding + 6, y + alturaDoValor + 4, {
        width: larguraDoTexto,
      });
  }

  document.y = topo + alturaTotal + RITMO.entreBlocos;
  document.x = esquerda;
}

/* ------------------------------------------------------------------ */
/* Resumo de valores                                                   */
/* ------------------------------------------------------------------ */

export interface TotalLine {
  readonly label: string;
  readonly value: string;
  /** Desconto e abatimento: sai em outra cor, com o sinal já no texto. */
  readonly negative?: boolean;
  /** A linha do total: régua acima, corpo maior. */
  readonly emphasis?: boolean;
}

/**
 * O resumo financeiro, alinhado à direita.
 *
 * ## Por que não é um cartão de definições
 *
 * Valores se conferem somando de cima para baixo, e para isso as casas
 * decimais precisam estar na mesma coluna. Num cartão de duas colunas os
 * números caem em posições diferentes conforme o rótulo ao lado, e quem
 * confere passa a somar valores desalinhados — que é exatamente como um
 * desconto lançado duas vezes passa despercebido.
 *
 * É a forma de uma fatura porque é a forma que quem recebe a proposta já sabe
 * ler.
 */
export function totalsBlock(
  document: Doc,
  linhas: readonly TotalLine[],
  theme: DocumentTheme,
): void {
  if (linhas.length === 0) return;

  const largura = contentWidth(document);
  /* Metade da página: o resumo encosta na margem direita, e o espaço à
     esquerda é o que faz o olho descer pela coluna dos números. */
  const larguraDoBloco = Math.min(largura * 0.55, 300);
  const esquerda = document.page.margins.left + largura - larguraDoBloco;
  const padding = 10;
  const larguraInterna = larguraDoBloco - padding * 2;

  const alturas = linhas.map((linha) => (linha.emphasis ? 22 : 15));
  const alturaTotal =
    alturas.reduce((soma, item) => soma + item, 0) + padding * 2;

  ensureSpace(document, alturaTotal + 10);

  const topo = document.y;

  document
    .save()
    .roundedRect(esquerda, topo, larguraDoBloco, alturaTotal, METRICS.radius)
    .fillColor(theme.surface)
    .fill()
    .roundedRect(esquerda, topo, larguraDoBloco, alturaTotal, METRICS.radius)
    .lineWidth(0.5)
    .strokeColor(theme.border)
    .stroke()
    .restore();

  let y = topo + padding;

  linhas.forEach((linha, indice) => {
    if (linha.emphasis) {
      document
        .save()
        .moveTo(esquerda + padding, y + 2)
        .lineTo(esquerda + larguraDoBloco - padding, y + 2)
        .lineWidth(0.7)
        .strokeColor(theme.border)
        .stroke()
        .restore();
      y += 6;
    }

    const corpo = linha.emphasis ? 11 : 8.5;
    const fonte = linha.emphasis ? FONTS.bold : FONTS.regular;
    const tinta = linha.emphasis
      ? theme.ink
      : linha.negative
        ? theme.accent
        : theme.inkMuted;

    document
      .font(linha.emphasis ? FONTS.bold : FONTS.regular)
      .fontSize(linha.emphasis ? 8 : 7.5)
      .fillColor(theme.inkFaint)
      .text(linha.label.toUpperCase(), esquerda + padding, y + 2, {
        width: larguraInterna * 0.55,
        characterSpacing: 0.3,
      });

    document
      .font(fonte)
      .fontSize(corpo)
      .fillColor(tinta)
      .text(linha.value, esquerda + padding + larguraInterna * 0.55, y, {
        width: larguraInterna * 0.45,
        align: 'right',
      });

    y += alturas[indice]!;
  });

  document.y = topo + alturaTotal + RITMO.entreBlocos;
  document.x = document.page.margins.left;
}

/* ------------------------------------------------------------------ */
/* Declaração em destaque                                              */
/* ------------------------------------------------------------------ */

/**
 * A conclusão de um laudo, em corpo maior e com faixa de acento.
 *
 * ## Por que não é um `noteBlock` com título
 *
 * Num laudo a conclusão **é** o documento: tudo antes dela existe para
 * sustentá-la, e quem recebe o papel procura por ela antes de ler o resto.
 * Impressa no mesmo corpo das constatações, ela vira mais um parágrafo e o
 * leitor precisa achar onde o texto deixa de descrever e passa a concluir.
 *
 * A faixa à esquerda é a mesma do valor no recibo e no orçamento, pela mesma
 * razão: marca onde olhar primeiro. Um documento onde tudo tem o mesmo peso
 * não tem destaque nenhum.
 */
export function statementBlock(
  document: Doc,
  texto: string,
  theme: DocumentTheme,
  options: { readonly title?: string } = {},
): void {
  const largura = contentWidth(document);
  const padding = 14;
  const larguraDoTexto = largura - padding * 2 - 6;

  const alturaDoTitulo = options.title ? 13 : 0;
  document.font(FONTS.regular).fontSize(10.5);
  const alturaDoTexto = document.heightOfString(texto, {
    width: larguraDoTexto,
    lineGap: 1.5,
  });
  const alturaTotal = alturaDoTitulo + alturaDoTexto + padding * 2;

  ensureSpace(document, alturaTotal + 8);

  const topo = document.y;
  const esquerda = document.page.margins.left;

  document
    .save()
    .roundedRect(esquerda, topo, largura, alturaTotal, METRICS.radius)
    .fillColor(theme.surfaceStrong)
    .fill()
    .rect(esquerda, topo, 4, alturaTotal)
    .fill(brandGradientVertical(document, topo, alturaTotal, theme))
    .restore();

  let y = topo + padding;

  if (options.title) {
    document
      .font(FONTS.bold)
      .fontSize(7)
      .fillColor(theme.inkFaint)
      .text(options.title.toUpperCase(), esquerda + padding + 6, y, {
        width: larguraDoTexto,
        characterSpacing: 0.4,
      });
    y += alturaDoTitulo;
  }

  document
    .font(FONTS.regular)
    .fontSize(10.5)
    .fillColor(theme.ink)
    .text(texto, esquerda + padding + 6, y, {
      width: larguraDoTexto,
      lineGap: 1.5,
    });

  document.y = topo + alturaTotal + RITMO.entreBlocos;
  document.x = esquerda;
}
