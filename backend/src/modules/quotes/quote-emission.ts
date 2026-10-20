/**
 * O que o documento de orçamento afirma, campo por campo.
 *
 * ## Por que o orçamento passa a nascer de uma execução
 *
 * Porque antes ele não nascia de nada. `GET /quotes/:id/document` renderizava um
 * PDF na hora e o devolvia pela conexão: sem código de documento, sem revisão,
 * sem hash, sem arquivo guardado. Baixar não deixava rastro — nem na central de
 * documentos emitidos, nem em lugar nenhum. A proposta que o cliente aprovou não
 * era recuperável: só existia a proposta **atual**, que pode ter mudado depois.
 *
 * Emitir passa a ser o que já é para o recibo e para o PMOC: uma execução do tipo
 * `ORCAMENTO` com as respostas preenchidas, um manifesto publicado e um arquivo
 * com hash. Baixar continua existindo e continua não deixando rastro — é
 * rascunho, e conferir o PDF antes de mandar não pode consumir número de
 * documento.
 *
 * ## Por que o mapa é um módulo e não seis chamadas soltas
 *
 * Mesma razão do `CAMPOS` do recibo: a ligação entre o que a proposta tem e o que
 * o documento imprime fica legível num lugar só. O que muda aqui é que a maior
 * parte dos campos não é cópia — itens viram texto, dinheiro vira decimal com
 * unidade, data vira data civil. Essa conversão é a parte que erra, e num módulo
 * ela se testa sem banco.
 */

/** Uma linha da proposta, como a listagem do documento a enxerga. */
export interface QuoteEmissionItem {
  readonly description: string;
  readonly unit: string;
  readonly quantity: unknown;
  readonly unitPrice: unknown;
  readonly total: unknown;
  readonly notes?: string | null;
}

export interface QuoteEmissionSource {
  readonly code: string;
  readonly title: string;
  readonly notes?: string | null;
  readonly introText?: string | null;
  readonly discountReason?: string | null;
  readonly validUntil?: Date | null;
  /** Quando a proposta foi ao cliente, ou quando nasceu se ainda não foi. */
  readonly issuedAt: Date;
  readonly total: unknown;
  readonly items: readonly QuoteEmissionItem[];
  readonly customer: {
    readonly legalName: string;
    readonly tradeName?: string | null;
    readonly documentType?: string | null;
    readonly documentNumber?: string | null;
  };
  readonly address?: {
    readonly street?: string | null;
    readonly number?: string | null;
    readonly complement?: string | null;
    readonly district?: string | null;
    readonly city?: string | null;
    readonly stateCode?: string | null;
  } | null;
  readonly responsibleName?: string | null;
}

/** Uma resposta a gravar na execução. */
export interface QuoteEmissionAnswer {
  readonly sectionId: string;
  readonly fieldId: string;
  readonly value: string;
  readonly unit?: string;
}

/** Dinheiro como o compositor premium espera: decimal com ponto, duas casas. */
export function decimalText(value: unknown): string {
  const numero =
    typeof value === 'number'
      ? value
      : Number((value as { toString(): string } | null)?.toString() ?? 'x');
  return Number.isFinite(numero) ? numero.toFixed(2) : '0.00';
}

/**
 * Quantidade sem zeros decorativos.
 *
 * `2.000` vira `2` e `1.500` vira `1.5`: a quantidade é guardada com três casas
 * porque existe meia hora de serviço, não porque "2" precise de três zeros na
 * frente do cliente.
 */
export function quantityText(value: unknown): string {
  const numero =
    typeof value === 'number'
      ? value
      : Number((value as { toString(): string } | null)?.toString() ?? 'x');
  if (!Number.isFinite(numero)) return '0';
  return String(Number(numero.toFixed(3)));
}

/** A data civil do `@db.Date`, sem o fuso puxar o dia para trás. */
export function dateOnlyText(
  value: Date | null | undefined,
): string | undefined {
  if (!value) return undefined;
  return value.toISOString().slice(0, 10);
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Os itens como texto, uma linha por item.
 *
 * O modelo oficial declara "Itens e quantidades" como texto longo, e não como
 * tabela: o compositor premium imprime o que o campo guarda. Então a tabela é
 * montada aqui, legível, em vez de o documento sair com um JSON dentro.
 *
 * O valor sai formatado em português porque este texto é lido por quem recebe a
 * proposta, não por outro programa — ao contrário de `valor_total`, que é campo
 * decimal e precisa de ponto para o Financeiro reconhecer dinheiro.
 */
export function itemsText(items: readonly QuoteEmissionItem[]): string {
  return items
    .map((item) => {
      const quantidade = `${quantityText(item.quantity)} ${item.unit}`.trim();
      const unitario = BRL.format(Number(decimalText(item.unitPrice)));
      const total = BRL.format(Number(decimalText(item.total)));
      const linha = `${item.description} — ${quantidade} × ${unitario} = ${total}`;
      /* A observação do item entra recuada: ela qualifica a linha de cima, e
         colada viraria parte da descrição. */
      return item.notes?.trim() ? `${linha}\n    ${item.notes.trim()}` : linha;
    })
    .join('\n');
}

/** O endereço numa linha, como o campo de texto do modelo espera. */
export function addressText(
  address: QuoteEmissionSource['address'],
): string | undefined {
  if (!address) return undefined;
  const rua = [address.street, address.number].filter(Boolean).join(', ');
  const complemento = address.complement?.trim();
  const bairro = address.district?.trim();
  const cidade = [address.city, address.stateCode].filter(Boolean).join('/');
  const partes = [rua, complemento, bairro, cidade].filter(
    (parte) => parte && parte.length > 0,
  );
  return partes.length ? partes.join(' — ') : undefined;
}

/** `CNPJ 12.345.678/0001-90`, ou só o número quando o tipo não foi declarado. */
export function documentText(
  type: string | null | undefined,
  value: string | null | undefined,
): string | undefined {
  const numero = value?.trim();
  if (!numero) return undefined;
  const tipo = type?.trim();
  return tipo ? `${tipo} ${numero}` : numero;
}

/**
 * As respostas do documento de orçamento.
 *
 * Campo vazio é **omitido**, não gravado em branco: o compositor esconde o que
 * não tem valor, e gravar string vazia imprimiria um rótulo seguido de nada.
 *
 * O que não existir no modelo da organização é descartado por quem grava — o
 * modelo é publicável, e recusar a emissão porque a casa tirou "Não incluso"
 * seria pior que emitir sem ele.
 */
export function quoteAnswers(
  source: QuoteEmissionSource,
): readonly QuoteEmissionAnswer[] {
  const objeto = [source.introText?.trim(), source.title.trim()]
    .filter((parte): parte is string => Boolean(parte))
    .join('\n\n');

  /* "Não incluso" recebe o que a proposta diz de ressalva: a observação geral e o
     motivo do desconto são exatamente o texto que o cliente precisa ler junto do
     preço, e o modelo não tem campo próprio para nenhum dos dois. */
  const exclusoes = [source.notes?.trim(), source.discountReason?.trim()]
    .filter((parte): parte is string => Boolean(parte))
    .join('\n\n');

  const candidatos: readonly (QuoteEmissionAnswer | undefined)[] = [
    campo(
      'identificacao',
      'cliente',
      source.customer.tradeName?.trim() || source.customer.legalName,
    ),
    campo(
      'identificacao',
      'documento',
      documentText(
        source.customer.documentType,
        source.customer.documentNumber,
      ),
    ),
    campo('identificacao', 'endereco', addressText(source.address)),
    campo('identificacao', 'contato', source.responsibleName?.trim()),
    campo('identificacao', 'data', dateOnlyText(source.issuedAt)),
    campo('escopo', 'objeto', objeto),
    campo('escopo', 'itens', itemsText(source.items)),
    campo('escopo', 'exclusoes', exclusoes),
    campo('condicoes', 'valor_total', decimalText(source.total), 'BRL'),
    campo('condicoes', 'validade', dateOnlyText(source.validUntil)),
  ];

  return candidatos.filter(
    (item): item is QuoteEmissionAnswer => item !== undefined,
  );
}

function campo(
  sectionId: string,
  fieldId: string,
  value: string | undefined,
  unit?: string,
): QuoteEmissionAnswer | undefined {
  if (!value) return undefined;
  return { sectionId, fieldId, value, ...(unit ? { unit } : {}) };
}
