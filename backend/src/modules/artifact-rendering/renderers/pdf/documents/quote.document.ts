/**
 * Orçamento — proposta comercial.
 *
 * ## É o único documento da série que precisa vender
 *
 * PMOC, RVT, OS e recibo registram algo que já aconteceu. O orçamento pede uma
 * decisão: alguém vai ler e responder sim ou não. Isso muda o que o desenho
 * precisa fazer — o total tem que ser achado num relance, o escopo tem que
 * deixar claro o que está e o que não está incluído, e tem que haver onde
 * assinar o aceite.
 *
 * ## O aceite é o que o modelo do setor esquece
 *
 * Uma proposta que só tem a assinatura do proponente obriga o cliente a
 * responder por outro canal — e-mail, WhatsApp, telefone — e aí a aprovação
 * fica fora do documento. O bloco de aceite dá onde assinar, com data, e
 * transforma o mesmo papel no comprovante da autorização.
 *
 * ## Desconto não é linha de item
 *
 * O modelo imprime o desconto como se fosse mais um serviço na tabela, com o
 * valor negativo na coluna de subtotal. Quem soma a coluna chega num número e
 * quem lê o total chega em outro. Desconto é abatimento e vai no resumo, onde
 * a conta fecha à vista.
 *
 * ## O que este compositor não faz
 *
 * Não recalcula nada. Subtotal, desconto e total vêm do domínio, que é quem os
 * conhece; refazer a conta aqui criaria uma segunda fonte de verdade sobre
 * dinheiro, e a folha impressa divergiria da tela no dia em que as duas
 * discordassem.
 */
import {
  amountBlock,
  definitionCard,
  groupLabel,
  noteBlock,
  sectionTitle,
  table,
  totalsBlock,
  type DefinitionItem,
  type TableColumn,
  type TotalLine,
} from '../kit/blocks';
import { signatureBlock } from '../kit/media-blocks';
import type { DocumentEmitter } from '../kit/document-context';
import type { DocumentTheme } from '../kit/theme';
import {
  moeda,
  valorPorExtenso,
} from '../../../../../contracts/amount-in-words';

type Doc = PDFKit.PDFDocument;

/** O que o documento do orçamento precisa saber. Montado pelo serviço. */
export interface QuoteDocumentInput {
  readonly quote: {
    readonly code: string;
    readonly title: string;
    readonly status?: string;
    readonly issuedAt?: string;
    readonly validUntil?: string;
    readonly validityDays?: number;
    readonly notes?: string;
    /**
     * Por que houve desconto.
     *
     * Impresso ao lado do abatimento, não numa seção própria: quem lê o valor é
     * quem pergunta o motivo, e separá-los faria a resposta ficar meia página
     * adiante da pergunta.
     */
    readonly discountReason?: string;
    /**
     * O parágrafo de abertura.
     *
     * Ausente imprime o padrão; string vazia imprime **nada** — quem apagou o
     * texto está dizendo que não quer abertura, e reinserir o padrão desfaria a
     * escolha em silêncio.
     */
    readonly introText?: string;
    readonly author?: string;
    readonly operationCode?: string;
  };
  /**
   * Quem responde tecnicamente, e de quem sai a assinatura.
   *
   * `signatureImage` é opcional: quem não cadastrou assinatura recebe a linha em
   * branco para assinar à mão, que é o que o papel sempre permitiu.
   */
  readonly responsible?: {
    readonly name: string;
    readonly roleLabel?: string;
    readonly signatureImage?: Buffer;
    readonly signatureImageMimeType?: string;
  };
  /**
   * Os equipamentos que a proposta cobre.
   *
   * Sem valor: preço é dos itens, e repeti-lo aqui daria duas respostas para
   * "quanto custa". Esta seção responde outra pergunta — *em que* se vai mexer —
   * que é a primeira que o cliente faz numa proposta de manutenção.
   */
  readonly assets?: readonly {
    readonly name: string;
    readonly identifier?: string;
    readonly location?: string;
  }[];
  readonly customer: {
    readonly name?: string;
    readonly legalName?: string;
    readonly document?: string;
    readonly email?: string;
    readonly phone?: string;
    readonly address?: string;
  };
  readonly items: readonly {
    readonly kind?: string;
    readonly description: string;
    readonly sku?: string;
    readonly unit?: string;
    readonly quantity: number;
    readonly unitPrice: number;
    readonly discount?: number;
    readonly total: number;
    readonly notes?: string;
  }[];
  readonly totals: {
    readonly subtotal: number;
    readonly discount: number;
    readonly total: number;
  };
}

/**
 * A fórmula que o setor usa para abrir uma proposta.
 *
 * Mora aqui, e não no banco, porque é o **padrão** — o que se imprime quando a
 * proposta não diz outra coisa. Uma linha por organização no banco teria de ser
 * semeada em toda instalação, e uma instalação nova sairia sem abertura.
 */
const ABERTURA_PADRAO =
  'Atendendo à honrosa solicitação de V.Sa., apresentamos nosso orçamento ' +
  'conforme solicitado.';

const COLUNAS_DO_EQUIPAMENTO: readonly TableColumn[] = [
  { header: 'Item', weight: 0.7, align: 'center' },
  { header: 'Equipamento', weight: 4.4 },
  { header: 'Identificação', weight: 2.2 },
  { header: 'Local', weight: 3 },
];

const COLUNAS_DO_ITEM: readonly TableColumn[] = [
  { header: 'Item', weight: 0.7, align: 'center' },
  { header: 'Descrição', weight: 4.6 },
  { header: 'Qtd.', weight: 1, align: 'right' },
  { header: 'Un.', weight: 0.9, align: 'center' },
  { header: 'Valor unit.', weight: 1.7, align: 'right' },
  { header: 'Subtotal', weight: 1.7, align: 'right' },
];

export function composeQuote(
  document: Doc,
  input: QuoteDocumentInput,
  emitter: DocumentEmitter | undefined,
  theme: DocumentTheme,
): void {
  identificacao(document, input, theme);
  cliente(document, input, theme);
  abertura(document, input, theme);
  equipamentos(document, input, theme);
  objeto(document, input, theme);
  itens(document, input, theme);
  resumo(document, input, theme);
  totalEmDestaque(document, input, theme);
  /* Não há seção de condições comerciais: o domínio de orçamentos não guarda
     forma de pagamento nem prazo de execução, e uma seção só com a validade
     repetiria o que a identificação já diz — que é exatamente o defeito do
     modelo que este documento substitui. */
  aceite(document, input, emitter, theme);
}

function identificacao(
  document: Doc,
  input: QuoteDocumentInput,
  theme: DocumentTheme,
): void {
  const proposta = input.quote;

  const itensDoCartao: DefinitionItem[] = [
    { label: 'Número', value: proposta.code },
    { label: 'Situação', value: situacao(proposta.status) },
    { label: 'Emitido em', value: proposta.issuedAt },
    { label: 'Válido até', value: validade(proposta) },
    { label: 'Elaborado por', value: proposta.author },
    { label: 'Atendimento relacionado', value: proposta.operationCode },
    { label: 'Título', value: proposta.title, full: true },
  ];

  sectionTitle(document, 'Identificação da proposta', theme);
  definitionCard(document, itensDoCartao, theme);
}

function cliente(
  document: Doc,
  input: QuoteDocumentInput,
  theme: DocumentTheme,
): void {
  const dados = input.customer;

  const contato = [dados.phone, dados.email].filter(Boolean).join(' · ');
  const itensDoCartao: DefinitionItem[] = [
    { label: 'Cliente', value: dados.name },
    { label: 'Razão social', value: dados.legalName },
    { label: 'Documento', value: dados.document },
    { label: 'Contato', value: contato.length > 0 ? contato : undefined },
    { label: 'Endereço', value: dados.address, full: true },
  ];
  if (!itensDoCartao.some((item) => item.value)) return;

  sectionTitle(document, 'Cliente', theme);
  definitionCard(document, itensDoCartao, theme);
}

/**
 * A abertura — a frase de cortesia que abre a proposta.
 *
 * Vem antes do escopo porque é o que se lê primeiro, e é o que distingue uma
 * proposta comercial de uma listagem de preços. O padrão existe porque é a
 * fórmula que o setor usa; o campo existe porque ela não serve para todo
 * cliente.
 */
function abertura(
  document: Doc,
  input: QuoteDocumentInput,
  theme: DocumentTheme,
): void {
  const texto = input.quote.introText ?? ABERTURA_PADRAO;
  /* String vazia é escolha: quem apagou não quer abertura. */
  if (texto.trim().length === 0) return;
  noteBlock(document, texto, theme);
}

/**
 * Os equipamentos cobertos.
 *
 * Tabela, e não parágrafo: identificação e local são o que o cliente confere
 * item por item — "é o da recepção ou o do depósito?" — e num texto corrido
 * essa conferência obriga a reler a frase inteira.
 */
function equipamentos(
  document: Doc,
  input: QuoteDocumentInput,
  theme: DocumentTheme,
): void {
  const lista = input.assets ?? [];
  if (lista.length === 0) return;

  sectionTitle(document, 'Equipamentos', theme);
  table(
    document,
    COLUNAS_DO_EQUIPAMENTO,
    lista.map((equipamento, indice) => [
      String(indice + 1).padStart(2, '0'),
      equipamento.name,
      equipamento.identifier ?? '',
      equipamento.location ?? '',
    ]),
    theme,
    { continuationLabel: '(continuação)' },
  );
}

/** O objeto da proposta — o texto que o vendedor escreveu. */
function objeto(
  document: Doc,
  input: QuoteDocumentInput,
  theme: DocumentTheme,
): void {
  if (!input.quote.notes) return;
  sectionTitle(document, 'Objeto da proposta', theme);
  noteBlock(document, input.quote.notes, theme);
}

/**
 * Serviços e materiais, nas mesmas colunas.
 *
 * O modelo do setor dá à tabela de materiais só descrição e quantidade, sem
 * preço. Quem lê não consegue conferir de onde veio o subtotal de materiais, e
 * a proposta passa a pedir confiança em vez de mostrar a conta. Aqui os dois
 * grupos têm as mesmas seis colunas — o que muda é o rótulo do grupo.
 */
function itens(
  document: Doc,
  input: QuoteDocumentInput,
  theme: DocumentTheme,
): void {
  if (input.items.length === 0) return;

  sectionTitle(document, 'Itens da proposta', theme);

  const servicos = input.items.filter((item) => ehServico(item.kind));
  const produtos = input.items.filter((item) => !ehServico(item.kind));
  const grupos: [string, typeof input.items][] = [];
  if (servicos.length > 0) grupos.push(['Serviços', servicos]);
  if (produtos.length > 0) grupos.push(['Materiais e fornecimentos', produtos]);

  let numero = 0;
  for (const [titulo, lista] of grupos) {
    /* Com um grupo só, repetir o rótulo logo abaixo do título da seção é
       ruído: a tabela já é evidentemente a lista de itens. */
    if (grupos.length > 1) groupLabel(document, titulo, theme);

    table(
      document,
      COLUNAS_DO_ITEM,
      lista.map((item) => {
        numero += 1;
        return [
          String(numero).padStart(2, '0'),
          descricaoDoItem(item),
          quantidade(item.quantity),
          item.unit,
          moeda(item.unitPrice),
          moeda(item.total),
        ];
      }),
      theme,
      { continuationLabel: '(continuação)' },
    );
  }
}

/**
 * O resumo dos valores.
 *
 * O desconto só aparece quando existe: uma linha "Desconto R$ 0,00" numa
 * proposta sugere que houve negociação e ela não rendeu nada, que é a última
 * impressão que um orçamento quer deixar.
 */
function resumo(
  document: Doc,
  input: QuoteDocumentInput,
  theme: DocumentTheme,
): void {
  const { subtotal, discount } = input.totals;
  /* Sem desconto, este bloco teria uma linha de subtotal igual ao total que
     aparece logo abaixo em destaque — o mesmo número duas vezes, coladas, e
     quem lê procura a diferença que não existe. */
  if (discount <= 0) return;

  const linhas: TotalLine[] = [
    { label: 'Subtotal', value: moeda(subtotal) },
    {
      label: 'Desconto',
      /* Hífen ASCII, e não o sinal de menos tipográfico (U+2212): a
         Helvetica do pdfkit codifica em WinAnsi, onde esse ponto de código
         não existe — e ele sai impresso como aspas. */
      value: `- ${moeda(discount)}`,
      negative: true,
    },
  ];

  /* A conta desce daqui e fecha no bloco de destaque, que é o próximo. Uma
     linha "Total" aqui e o mesmo total um centímetro abaixo seria repetição:
     este bloco mostra a conta, aquele dá a resposta. */
  totalsBlock(document, linhas, theme);

  /*
   * O motivo do desconto, entre o abatimento e o total.
   *
   * Não vai no rótulo da linha: `totalsBlock` escreve rótulos em caixa alta —
   * certo para "SUBTOTAL", péssimo para uma frase, que sai gritada e mais difícil
   * de ler. E não vai em seção própria, que deixaria a resposta meia página
   * depois da pergunta. Aqui é o lugar exato onde alguém pergunta "por quê?":
   * logo abaixo do valor abatido, logo acima do que se vai pagar.
   */
  if (input.quote.discountReason) {
    noteBlock(document, `Desconto: ${input.quote.discountReason}`, theme);
  }
}

function totalEmDestaque(
  document: Doc,
  input: QuoteDocumentInput,
  theme: DocumentTheme,
): void {
  amountBlock(document, moeda(input.totals.total), theme, {
    label: 'Valor total da proposta',
    inWords: valorPorExtenso(input.totals.total),
  });
}

/**
 * Onde o cliente aprova.
 *
 * Sem este bloco, a aprovação acontece por e-mail ou WhatsApp e fica fora do
 * documento — e quando alguém precisa provar que a execução foi autorizada, o
 * papel não diz nada. Com ele, a mesma folha vira o comprovante.
 *
 * A linha do proponente vem junto porque uma proposta assinada só de um lado
 * é oferta, não acordo.
 */
function aceite(
  document: Doc,
  input: QuoteDocumentInput,
  emitter: DocumentEmitter | undefined,
  theme: DocumentTheme,
): void {
  sectionTitle(document, 'Aceite', theme, { espacoMinimo: 150 });
  noteBlock(
    document,
    'Declaro estar de acordo com o escopo, os valores e as condições ' +
      'descritos nesta proposta, e autorizo a execução dos serviços.',
    theme,
  );

  /*
   * Quem assina é o responsável, não a empresa.
   *
   * Antes daqui a linha do proponente levava o nome fantasia do emissor e o
   * autor como "credencial" — ou seja, a proposta era assinada por uma pessoa
   * jurídica, e a pessoa que responde por ela aparecia em letra miúda. Quem
   * recebe a proposta precisa saber com quem falar, e a assinatura registrada
   * é dessa pessoa.
   *
   * Sem responsável definido, cai no emissor: uma proposta antiga não perde o
   * bloco de aceite por causa de um campo que ainda não existia quando ela
   * nasceu.
   */
  const responsavel = input.responsible;

  signatureBlock(
    document,
    [
      {
        label: 'Proponente',
        signerName:
          responsavel?.name ?? emitter?.tradeName ?? emitter?.legalName,
        roleLabel: responsavel?.roleLabel ?? 'Responsável pela proposta',
        /* Com responsável, a credencial é a empresa que ele representa; sem
           ele, o autor — que era a única pessoa que o documento conhecia. */
        credential: responsavel
          ? (emitter?.tradeName ?? emitter?.legalName)
          : input.quote.author,
        image: responsavel?.signatureImage,
        imageMimeType: responsavel?.signatureImageMimeType,
      },
      {
        label: 'Aceite do cliente',
        signerName: input.customer.name ?? input.customer.legalName,
        roleLabel: 'Data: ____ / ____ / ________',
      },
    ],
    theme,
  );
}

/* ------------------------------------------------------------------ */
/* Formatação                                                          */
/* ------------------------------------------------------------------ */

function ehServico(kind?: string): boolean {
  return (kind ?? '').toUpperCase() === 'SERVICE';
}

/** Descrição com SKU e observação, quando existem. */
function descricaoDoItem(item: QuoteDocumentInput['items'][number]): string {
  const partes = [item.description];
  if (item.sku) partes.push(`(${item.sku})`);
  const primeira = partes.join(' ');
  return item.notes ? `${primeira}\n${item.notes}` : primeira;
}

/**
 * Quantidade sem casas decimais inúteis.
 *
 * `Decimal(14,3)` devolve "1.000" para uma unidade, e "1,000 SERV" numa
 * proposta faz o leitor procurar o separador de milhar que não existe.
 */
function quantidade(valor: number): string {
  if (!Number.isFinite(valor)) return '';
  return Number.isInteger(valor)
    ? String(valor)
    : new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 3,
      }).format(valor);
}

function validade(quote: QuoteDocumentInput['quote']): string | undefined {
  if (!quote.validUntil) return undefined;
  return quote.validityDays !== undefined && quote.validityDays > 0
    ? `${quote.validUntil} (${quote.validityDays} ${quote.validityDays === 1 ? 'dia' : 'dias'})`
    : quote.validUntil;
}

function situacao(status?: string): string | undefined {
  if (!status) return undefined;
  const rotulos: Readonly<Record<string, string>> = {
    DRAFT: 'Rascunho',
    SENT: 'Enviada',
    APPROVED: 'Aprovada',
    REJECTED: 'Recusada',
    EXPIRED: 'Expirada',
    CANCELLED: 'Cancelada',
    CONVERTED: 'Convertida em atendimento',
  };
  return rotulos[status] ?? status;
}
