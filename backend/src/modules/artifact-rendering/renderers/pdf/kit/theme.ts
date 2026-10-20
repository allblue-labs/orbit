/**
 * O tema dos documentos premium.
 *
 * ## Por que existe um tema, e não cores soltas no desenho
 *
 * O documento sai com a marca de quem o emite: a cor de destaque vem de
 * `layout.visualIdentity` do template e muda por organização. Espalhar
 * `#1d4ed8` pelo código faria a metade esquecida continuar azul quando alguém
 * configurasse verde — e ninguém repara num rodapé.
 *
 * ## As cores neutras não acompanham a marca
 *
 * Só o destaque é do cliente. Texto, bordas e superfícies continuam sendo os
 * mesmos em qualquer organização, porque é o que garante que o documento
 * continue legível quando a cor escolhida for clara demais, escura demais ou
 * simplesmente feia. A marca decora; o contraste é responsabilidade nossa.
 */
import { resolve } from 'node:path';
import { safeColor } from '../../html/html-safe';

export interface DocumentTheme {
  /** A cor da organização, já validada. Início do degradê. */
  readonly accent: string;
  /**
   * O fim do degradê.
   *
   * Com a marca do Orbit é o roxo; com uma cor de organização é uma variação
   * da própria cor, girada no matiz — assim o degradê continua existindo sem
   * misturar a marca do cliente com a nossa.
   */
  readonly accentEnd: string;
  /** Uma versão clara do destaque, para preenchimentos. */
  readonly accentSoft: string;
  readonly ink: string;
  readonly inkMuted: string;
  readonly inkFaint: string;
  readonly border: string;
  /**
   * Um fio mais claro que a régua comum.
   *
   * Fecha o cabeçalho sem disputar com ele: ali a divisão precisa existir e
   * não precisa ser vista, porque quem marca o começo da folha é a faixa de
   * marca no topo.
   */
  readonly hairline: string;
  readonly surface: string;
  readonly surfaceStrong: string;
  /**
   * O par grafite da faixa do cabeçalho.
   *
   * Não é preto puro: é um grafite no mesmo eixo azul-arroxeado da marca, com
   * uma leve deriva para o roxo no fim. Preto puro ao lado de um degradê
   * colorido parece buraco na folha; este par parece a sombra da própria cor.
   */
  readonly shellStart: string;
  /** Parada intermediária: segura o azul na metade do título. */
  readonly shellMid: string;
  readonly shellEnd: string;
  /** Tinta sobre a faixa escura. */
  readonly onShell: string;
  readonly onShellMuted: string;
}

/**
 * A marca do Orbit, em hex.
 *
 * Os tokens do produto são OKLCH (`--gradient-orbit` em `globals.css`), que o
 * pdfkit não entende. Convertidos uma vez e fixados aqui: converter em tempo
 * de execução exigiria uma implementação de espaço de cor no backend para
 * produzir sempre os mesmos dois valores.
 *
 * `oklch(0.55 0.19 258)` → azul · `oklch(0.56 0.20 296)` → roxo
 */
const ORBIT_INICIO = '#156CDD';
const ORBIT_FIM = '#8250DA';

/**
 * Uma versão clara da cor de destaque, para faixas e cabeçalhos de tabela.
 *
 * Misturada com branco em vez de usar opacidade: pdfkit aplica opacidade ao
 * estado gráfico inteiro, e um preenchimento translúcido acabaria clareando a
 * borda e o texto desenhados em seguida.
 */
function clarear(hex: string, proporcao: number): string {
  const limpo = hex.replace('#', '');
  const canal = (posicao: number) =>
    Number.parseInt(limpo.slice(posicao, posicao + 2), 16);
  const misturar = (valor: number) =>
    Math.round(valor + (255 - valor) * proporcao)
      .toString(16)
      .padStart(2, '0');
  return `#${misturar(canal(0))}${misturar(canal(2))}${misturar(canal(4))}`;
}

export function buildTheme(primaryColor?: string): DocumentTheme {
  /**
   * O fallback de `safeColor` é passado vazio de propósito.
   *
   * O padrão dele é `#17213a`, quase preto — e como ele devolve o fallback em
   * vez de vazio, todo documento que não recebia cor da organização saía
   * monocromático **achando que tinha cor**. Era o caso do documento do plano
   * de PMOC e do orçamento, os dois únicos que não passam `primaryColor`.
   * Pedindo o vazio, a ausência volta a ser distinguível da escolha.
   */
  const escolhida = safeColor(primaryColor, '');
  const accent = escolhida || ORBIT_INICIO;
  /* Sem cor da organização, o degradê é o do Orbit. Com cor, o fim é a
     própria cor girada no matiz: o documento ganha profundidade sem passar a
     exibir a marca do Orbit sobre o timbre de outra empresa. */
  const accentEnd = escolhida ? girarMatiz(escolhida, 32) : ORBIT_FIM;

  return {
    accent,
    accentEnd,
    accentSoft: clarear(accent, 0.9),
    /**
     * Neutros com viés azul-arroxeado, do mesmo eixo da marca: um cinza puro
     * ao lado do degradê do Orbit parece sujo.
     *
     * `inkFaint` carrega os rótulos dos cartões, em corpo 7. Estava em
     * `#7F8696`, que dá **3,65 de contraste** sobre o branco — abaixo do
     * mínimo 4,5 que a WCAG pede para texto pequeno, e por isso os rótulos
     * sumiam na folha impressa. Em `#61697B` são 5,5, com folga.
     *
     * A régua também subiu: com os cartões sem caixa, é ela que separa um par
     * do seguinte, e a 1,35 de contraste ela simplesmente não existia.
     */
    ink: '#1A233A',
    inkMuted: '#565E6F',
    inkFaint: '#61697B',
    border: '#CCD1DC',
    hairline: '#E9EBF1',
    surface: '#F5F7FB',
    surfaceStrong: '#EDF0F8',
    /**
     * A faixa é azul-marinho, não grafite.
     *
     * O primeiro par (`#0F1526`) era escuro demais e praticamente sem matiz:
     * lido como preto, brigava com o degradê logo abaixo em vez de prepará-lo.
     * O segundo (`#173463`) corrigiu o matiz e foi longe demais na
     * luminosidade — a faixa perdeu peso e o título branco deixou de assentar.
     *
     * Este fica entre os dois: a profundidade do primeiro com o azul do
     * segundo.
     *
     * O azul da ponta esquerda é mais vivo que o do meio de propósito: é a
     * amplitude entre as duas pontas que dá definição à faixa. Um degradê
     * entre dois tons igualmente escuros lê como mancha chapada, e foi o que
     * aconteceu quando as duas pontas ficaram na mesma casa de luminosidade.
     *
     * **O fim é mais escuro que o início, e não mais claro.** É o erro que
     * passou despercebido na versão anterior: o roxo do lado direito estava
     * uma parada acima do azul, e como ele ocupa a metade da faixa onde fica o
     * timbre, era ele que definia a leitura de "claro" — a faixa parecia
     * lavada mesmo com o início escuro. Num degradê de fundo, o fim puxa para
     * baixo ou a peça perde assento.
     */
    shellStart: '#143056',
    shellMid: '#16264C',
    shellEnd: '#231A3E',
    onShell: '#FFFFFF',
    /* 6,1 de contraste sobre a faixa: o timbre é secundário, não ilegível. */
    onShellMuted: '#B1B7C5',
  };
}

/**
 * Gira o matiz mantendo saturação e brilho.
 *
 * É o que dá o segundo ponto do degradê quando a organização escolheu uma cor:
 * 32° é o bastante para o olho perceber a transição e pouco para a peça ainda
 * ser reconhecida como "aquela cor".
 */
function girarMatiz(hex: string, graus: number): string {
  const limpo = hex.replace('#', '');
  const canal = (posicao: number) =>
    Number.parseInt(limpo.slice(posicao, posicao + 2), 16) / 255;
  const [r, g, b] = [canal(0), canal(2), canal(4)];

  const maximo = Math.max(r, g, b);
  const minimo = Math.min(r, g, b);
  const luz = (maximo + minimo) / 2;
  const delta = maximo - minimo;
  if (delta === 0) return hex;

  const saturacao = delta / (1 - Math.abs(2 * luz - 1));
  let matiz: number;
  if (maximo === r) matiz = ((g - b) / delta) % 6;
  else if (maximo === g) matiz = (b - r) / delta + 2;
  else matiz = (r - g) / delta + 4;
  matiz = (matiz * 60 + graus + 360) % 360;

  const c = (1 - Math.abs(2 * luz - 1)) * saturacao;
  const x = c * (1 - Math.abs(((matiz / 60) % 2) - 1));
  const m = luz - c / 2;
  const faixa = Math.floor(matiz / 60);
  const bruto: [number, number, number] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][faixa] as [number, number, number];

  const hexar = (valor: number) =>
    Math.round((valor + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hexar(bruto[0])}${hexar(bruto[1])}${hexar(bruto[2])}`;
}

/**
 * O degradê da marca, como o pdfkit o entende.
 *
 * Um retângulo pintado com isto recebe a transição diagonal do produto — a
 * mesma de `--gradient-orbit`, a 135°. Usado na faixa do topo e nas faixas dos
 * blocos de destaque; o resto do documento continua chapado, porque degradê em
 * tudo é o que faz uma peça impressa parecer apresentação de vendas.
 */
/** O grafite da faixa, em degradê diagonal como o da marca. */

/**
 * O degradê da marca, ancorado na **página**.
 *
 * ## Por que não na peça
 *
 * Cada peça calculava o próprio degradê sobre a própria largura: a faixa do
 * topo ia de 0 a 595, o cabeçalho de tabela de 40 a 555. Uma coluna em x=300
 * caía em 50% do degradê numa peça e em 51% na outra — e como as duas usam as
 * mesmas duas cores, o documento parecia ter várias, o que quebra a leitura de
 * peça única. Com quatro tabelas na mesma página o efeito era evidente.
 *
 * Ancorando em `0 → page.width`, o degradê é um só, da página inteira, e cada
 * faixa é uma janela nele. Duas peças na mesma coluna passam a mostrar
 * exatamente o mesmo tom — que é o que faz um documento parecer desenhado de
 * uma vez.
 *
 * A parada em 45% segura o azul na metade esquerda, onde ficam o título e o
 * código.
 */
function pageGradient(
  document: PDFKit.PDFDocument,
  inicio: string,
  meio: string,
  fim: string,
): PDFKit.PDFGradient {
  return document
    .linearGradient(0, 0, document.page.width, 0)
    .stop(0, inicio)
    .stop(0.45, meio)
    .stop(1, fim);
}

/** O grafite da faixa e dos cabeçalhos de tabela. */
export function shellGradient(
  document: PDFKit.PDFDocument,
  theme: DocumentTheme,
): PDFKit.PDFGradient {
  return pageGradient(
    document,
    theme.shellStart,
    theme.shellMid,
    theme.shellEnd,
  );
}

/** O azul-para-roxo vivo: filete do topo, réguas e pílula. */
export function brandGradient(
  document: PDFKit.PDFDocument,
  theme: DocumentTheme,
): PDFKit.PDFGradient {
  return pageGradient(document, theme.accent, theme.accent, theme.accentEnd);
}

/**
 * A versão vertical, para as barras estreitas dos blocos de destaque.
 *
 * Uma barra de 4pt de largura sob o degradê da página sairia chapada — pega um
 * ponto só dele. Aqui a transição corre na altura, que é a dimensão que a
 * barra tem.
 */
export function brandGradientVertical(
  document: PDFKit.PDFDocument,
  y: number,
  altura: number,
  theme: DocumentTheme,
): PDFKit.PDFGradient {
  return document
    .linearGradient(0, y, 0, y + altura)
    .stop(0, theme.accent)
    .stop(1, theme.accentEnd);
}

/** Medidas em pontos (1 pt = 1/72 pol). A4 tem 595 × 842. */
export const METRICS = {
  pageMargin: 40,
  /**
   * Altura reservada no topo.
   *
   * Vale para todas as páginas, mas só a primeira a preenche: nela a faixa
   * ocupa a altura inteira, com o logo do cliente acima do nome do documento,
   * o código em pílula e o timbre à direita. A altura comporta o logo sem
   * comprimir o resto — foi o que obrigou a subir de 104. Da segunda em
   * diante o cabeçalho é compacto e o que sobra vira respiro — que é melhor
   * que repetir o timbre inteiro em toda folha de um documento de seis
   * páginas.
   */
  headerHeight: 164,
  /**
   * A margem real do documento, e a altura do cabeçalho compacto.
   *
   * Da segunda página em diante só há o filete, a identificação da folha e a
   * régua — cabe em muito menos que os 164 da primeira. Como a margem do
   * pdfkit vale para o documento inteiro, ela é **esta**, a menor: a primeira
   * página empurra o cursor para `headerHeight` antes de compor.
   *
   * Sem isso, ou a página 1 comprimia o timbre ou as seguintes começavam o
   * texto 120 pontos abaixo da própria régua.
   */
  compactHeaderHeight: 72,
  /**
   * Distância entre o fio que fecha o cabeçalho e a primeira linha do
   * conteúdo — e, da segunda página em diante, entre a régua do cabeçalho
   * compacto e o conteúdo.
   *
   * Vale para todas as páginas de propósito: era 14 na primeira e 109 nas
   * demais, porque o compacto era desenhado no topo da área reservada em vez
   * de junto do conteúdo. A folha virava e o texto começava num lugar
   * diferente.
   */
  headerGap: 22,
  /** Altura reservada no rodapé para a linha de identificação. */
  footerHeight: 44,
  gutter: 18,
  /* 6 em vez de 4: o canto mais aberto é o que separa uma peça desenhada
     agora de um formulário dos anos 2000. Acima disso a tabela começa a
     parecer botão. */
  radius: 6,
} as const;

/**
 * A tipografia do documento é a do produto: Inter.
 *
 * ## Por que sair da Helvetica
 *
 * Helvetica é uma das catorze fontes que todo leitor de PDF já tem, então não
 * precisa ser embutida — foi por isso que estava ali. Mas ela é do começo dos
 * anos 1960, desenhada para tipos de metal e sinalização: em corpo pequeno
 * sobre papel, os traços afinam e as contraformas fecham. É o "muito fina"
 * que se vê num rótulo de 7 pontos.
 *
 * Inter foi desenhada para texto pequeno em tela e imprime bem: altura de x
 * maior, contraformas abertas, e um peso `Medium` que dá corpo sem virar
 * negrito. E é a fonte que o produto já usa no web e no mobile — o documento
 * deixa de ser a única peça com tipografia própria.
 *
 * ## O custo
 *
 * Embutir a fonte acrescenta cerca de 100 KB por arquivo por peso usado. Num
 * documento que o cliente arquiva e imprime, é troca barata: sem embutir, o
 * PDF depende de o leitor ter a fonte, e quando não tem ele substitui por
 * outra — e aí a paginação que medimos aqui deixa de valer.
 *
 * Licenciada em SIL Open Font License; o texto acompanha os arquivos.
 */
export const FONTS = {
  regular: 'Inter',
  /** Para rótulos e títulos: Semibold segura melhor que Bold em caixa alta. */
  bold: 'Inter-Semibold',
  strong: 'Inter-Bold',
  /** Identificadores e códigos. Courier continua: é o que diz "isto é um
      código", e não há mono da marca com arquivo no repositório. */
  mono: 'Courier',
} as const;

/** Onde os arquivos da fonte vivem, a partir da raiz do backend. */
/**
 * O arquivo de cada peso, e a fonte padrão do PDF que o substitui.
 *
 * O substituto existe porque a alternativa é o documento não sair. E ele tem de
 * ser **registrado com o mesmo nome**: `document.font('Inter-Semibold')` sem
 * registro prévio faz o pdfkit tratar o nome como caminho de arquivo e estourar
 * `ENOENT` na primeira linha de texto.
 */
export const FONT_FILES = {
  Inter: { file: 'assets/fonts/Inter-500.ttf', fallback: 'Helvetica' },
  'Inter-Semibold': {
    file: 'assets/fonts/Inter-600.ttf',
    fallback: 'Helvetica-Bold',
  },
  'Inter-Bold': {
    file: 'assets/fonts/Inter-700.ttf',
    fallback: 'Helvetica-Bold',
  },
} as const;

/**
 * Registra a tipografia no documento.
 *
 * Chamada uma vez por documento, antes de qualquer texto.
 *
 * ## O `catch` vazio escondia uma falha fatal
 *
 * A primeira versão só engolia o erro de registro, na suposição de que "o pdfkit
 * cai nas catorze padrão do PDF". Não cai: sem registro, o nome lógico não
 * existe, e `document.font('Inter-Semibold')` é interpretado como **caminho de
 * arquivo**. O resultado foi `ENOENT` em toda emissão premium na imagem de
 * produção, onde `assets/` não era copiada — falha que nenhum teste pegou,
 * porque no host o arquivo está lá.
 *
 * Agora a ausência do arquivo é registrada como apelido de uma fonte padrão: o
 * documento sai em Helvetica, que é o que a intenção original dizia.
 */
export function registerFonts(document: PDFKit.PDFDocument): void {
  for (const [nome, { file, fallback }] of Object.entries(FONT_FILES)) {
    try {
      document.registerFont(nome, resolve(process.cwd(), file));
    } catch {
      /* `registerFont` com o nome de uma das catorze padrão vira apelido — o
         pdfkit reconhece a string antes de tentar ler arquivo. */
      document.registerFont(nome, fallback);
    }
  }
}
