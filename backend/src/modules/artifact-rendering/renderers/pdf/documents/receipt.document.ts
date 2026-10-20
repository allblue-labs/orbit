/**
 * Recibo.
 *
 * ## É o único documento da série que prova um fato jurídico
 *
 * PMOC, RVT e OS registram trabalho. O recibo declara **quitação**: depois de
 * assinado, quem pagou tem como provar que pagou, e quem recebeu não pode
 * cobrar de novo. Por isso ele é curto e por isso cada palavra importa.
 *
 * ## O valor é o documento
 *
 * Sai em destaque, com o extenso logo abaixo. O extenso não é enfeite: "1"
 * vira "7" com um traço de caneta, e "R$ 120,00" vira "R$ 7.120,00" com espaço
 * sobrando à esquerda. Duas formas do mesmo número, uma conferindo a outra,
 * é o que faz o papel valer como prova.
 *
 * ## A declaração é montada, não copiada
 *
 * O texto de quitação cita o pagador, o documento dele, o valor em número e
 * por extenso e o que foi pago. Montá-lo a partir dos campos garante que ele
 * nunca diverge do cartão logo acima — num recibo, uma divergência entre a
 * declaração e os dados é o que invalida o documento.
 *
 * ## O que este compositor não afirma
 *
 * Não diz que o recibo substitui nota fiscal, não calcula imposto e não emite
 * garantia que ninguém registrou. Prazo de garantia só aparece se estiver
 * preenchido; inventar noventa dias porque é o costume do setor seria assumir
 * uma obrigação no lugar de quem assina.
 */
import {
  amountBlock,
  definitionCard,
  noteBlock,
  sectionTitle,
  type DefinitionItem,
} from '../kit/blocks';
import { signatureBlock } from '../kit/media-blocks';
import type { DocumentContext } from '../kit/document-context';
import type { DocumentTheme } from '../kit/theme';
import type { RenderFieldInput, RenderInput } from '../../artifact-renderer';
import { formatAnswer } from '../../html/html-safe';
import { answerText } from './answer-text';
import {
  moeda,
  valorPorExtenso,
} from '../../../../../contracts/amount-in-words';
import { roleLabel } from './labels';

type Doc = PDFKit.PDFDocument;

const CAMPOS_PROPRIOS = new Set([
  'pagador',
  'documento_pagador',
  'data',
  'valor',
  'referente',
  'forma_pagamento',
  'garantia',
  'garantia_dias',
]);

export function composeReceipt(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const valor = valorRecebido(input);

  identificacao(document, input, context, theme);
  valorEmDestaque(document, valor, theme);
  declaracao(document, input, context, valor, theme);
  garantia(document, input, theme);
  respostasLivres(document, input, theme);
  assinaturas(document, input, theme);
}

function identificacao(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  theme: DocumentTheme,
): void {
  const cliente = context.customer;

  const itens: DefinitionItem[] = [
    { label: 'Número', value: input.execution.code },
    { label: 'Data', value: dataDoRecibo(input, context) },
    { label: 'Recebemos de', value: pagador(input, context) },
    {
      label: 'Documento do pagador',
      value: valorDoCampo(input, 'documento_pagador') ?? cliente?.document,
    },
    {
      label: 'Forma de pagamento',
      value: valorDoCampo(input, 'forma_pagamento'),
    },
    { label: 'Atendimento relacionado', value: context.operation?.code },
    { label: 'Endereço', value: cliente?.address, full: true },
  ];

  sectionTitle(document, 'Identificação do recibo', theme);
  definitionCard(document, itens, theme);
}

function valorEmDestaque(
  document: Doc,
  valor: number | undefined,
  theme: DocumentTheme,
): void {
  if (valor === undefined) return;
  amountBlock(document, moeda(valor), theme, {
    label: 'Valor recebido',
    inWords: valorPorExtenso(valor),
  });
}

/**
 * A declaração de quitação.
 *
 * Montada a partir dos campos, nunca copiada de um texto fixo: assim ela não
 * pode divergir do cartão acima. Quando falta o valor, a frase de quitação
 * ainda vale — o que não se faz é escrever "a quantia de R$ undefined".
 */
function declaracao(
  document: Doc,
  input: RenderInput,
  context: DocumentContext,
  valor: number | undefined,
  theme: DocumentTheme,
): void {
  const quem = pagador(input, context);
  const documento =
    valorDoCampo(input, 'documento_pagador') ?? context.customer?.document;
  const referente = valorDoCampo(input, 'referente');

  const partes: string[] = ['Recebemos'];
  if (quem) partes.push(`de ${quem}`);
  if (documento) partes.push(`(${documento})`);
  if (valor !== undefined) {
    partes.push(`a quantia de ${moeda(valor)} (${valorPorExtenso(valor)})`);
  }
  if (referente)
    partes.push(`referente a ${minuscula(semPontoFinal(referente))}`);

  const texto =
    `${partes.join(' ')}, dando plena, geral e irrevogável quitação ` +
    'pelo valor recebido, para nada mais reclamar em tempo algum.';

  sectionTitle(document, 'Declaração de quitação', theme);
  noteBlock(document, texto, theme);
}

/**
 * A garantia, com a data de término calculada.
 *
 * O modelo do setor imprime "90 dias" e "início da contagem". Quem lê quer
 * saber até quando, e fazer a conta na cabeça a partir de uma data e um prazo
 * é exatamente o tipo de esforço que o documento devia poupar — e onde as
 * divergências nascem.
 */
function garantia(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const dias = diasDeGarantia(input);
  if (dias === undefined) return;

  const inicio = dataCivil(input);
  const itens: DefinitionItem[] = [
    { label: 'Prazo', value: `${dias} ${dias === 1 ? 'dia' : 'dias'}` },
    {
      label: 'Início da contagem',
      value: inicio ? formatCivil(inicio) : undefined,
    },
    { label: 'Válida até', value: terminoDaGarantia(inicio, dias) },
  ];

  sectionTitle(document, 'Garantia', theme);
  definitionCard(document, itens, theme);
}

function respostasLivres(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  const itens: DefinitionItem[] = [...input.sections]
    .sort((esquerda, direita) => esquerda.order - direita.order)
    .flatMap((secao) =>
      [...secao.fields]
        .filter((campo) => !campo.hidden && !CAMPOS_PROPRIOS.has(campo.id))
        .sort((esquerda, direita) => esquerda.order - direita.order)
        .map((campo) => {
          const texto = answerText(campo);
          return {
            label: campo.unit ? `${campo.label} (${campo.unit})` : campo.label,
            value: texto,
            full: texto.length > 60,
          };
        }),
    )
    .filter((item) => item.value);

  if (itens.length === 0) return;

  sectionTitle(document, 'Outras informações registradas', theme);
  definitionCard(document, itens, theme);
}

function assinaturas(
  document: Doc,
  input: RenderInput,
  theme: DocumentTheme,
): void {
  if (input.signatures.length === 0) return;
  sectionTitle(document, 'Assinatura de quem recebeu', theme, {
    espacoMinimo: 130,
  });
  signatureBlock(
    document,
    [...input.signatures]
      .sort((esquerda, direita) => esquerda.order - direita.order)
      .map((assinatura) => ({
        label: assinatura.label,
        signerName: assinatura.signerName,
        roleLabel: roleLabel(assinatura.signerRole),
        credential: assinatura.professionalCredential,
        signedAtLabel: assinatura.signedAt
          ? formatDateTime(assinatura.signedAt)
          : undefined,
        image: assinatura.signatureImage,
        imageMimeType: assinatura.signatureImageMimeType,
      })),
    theme,
  );
}

/* ------------------------------------------------------------------ */
/* Leitura das respostas                                               */
/* ------------------------------------------------------------------ */

/**
 * O valor recebido, como número.
 *
 * `DECIMAL` chega como string do banco e como número do app. Um valor que não
 * vira número devolve `undefined`, e o documento sai sem o bloco de destaque —
 * imprimir "R$ NaN" num recibo é pior que omitir, porque parece um valor.
 */
function valorRecebido(input: RenderInput): number | undefined {
  const campo = campoPorId(input, 'valor');
  if (!campo) return undefined;
  const bruto = campo.value;

  if (typeof bruto === 'number') {
    return Number.isFinite(bruto) && bruto >= 0 ? bruto : undefined;
  }
  if (typeof bruto !== 'string') return undefined;

  /* "R$ 1.234,56" e "1234.56" chegam os dois; o separador decimal é o último
     ponto ou vírgula que aparece. */
  const limpo = bruto.replace(/[^\d.,-]/g, '').trim();
  if (limpo === '') return undefined;
  const ultimoSeparador = Math.max(
    limpo.lastIndexOf(','),
    limpo.lastIndexOf('.'),
  );
  const normalizado =
    ultimoSeparador === -1
      ? limpo.replace(/[.,]/g, '')
      : `${limpo.slice(0, ultimoSeparador).replace(/[.,]/g, '')}.${limpo.slice(ultimoSeparador + 1)}`;

  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero >= 0 ? numero : undefined;
}

function diasDeGarantia(input: RenderInput): number | undefined {
  for (const id of ['garantia_dias', 'garantia']) {
    const campo = campoPorId(input, id);
    if (!campo || campo.hidden) continue;
    const texto = formatAnswer(campo.value).trim();
    const numero = /(\d+)/.exec(texto);
    if (!numero) continue;
    const dias = Number(numero[1]);
    if (Number.isFinite(dias) && dias > 0) return dias;
  }
  return undefined;
}

function terminoDaGarantia(
  inicio: string | undefined,
  dias: number,
): string | undefined {
  if (!inicio) return undefined;
  const [ano, mes, dia] = inicio.split('-').map(Number);
  if (!ano || !mes || !dia) return undefined;
  /* UTC de propósito: a conta é de dias civis, e somar em horário local faria
     a data virar na mudança de fuso. */
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return formatCivil(data.toISOString().slice(0, 10));
}

/** A data do recibo em ISO civil, para conta; `undefined` se não houver. */
function dataCivil(input: RenderInput): string | undefined {
  const campo = campoPorId(input, 'data');
  if (!campo) return undefined;
  const texto = formatAnswer(campo.value).trim();
  const civil = /^(\d{4}-\d{2}-\d{2})/.exec(texto);
  return civil ? civil[1] : undefined;
}

function dataDoRecibo(
  input: RenderInput,
  context: DocumentContext,
): string | undefined {
  return valorDoCampo(input, 'data') ?? context.operation?.completedAt;
}

function pagador(
  input: RenderInput,
  context: DocumentContext,
): string | undefined {
  return valorDoCampo(input, 'pagador') ?? context.customer?.name;
}

function campoPorId(
  input: RenderInput,
  id: string,
): RenderFieldInput | undefined {
  for (const secao of input.sections) {
    const achado = secao.fields.find((item) => item.id === id);
    if (achado) return achado;
  }
  return undefined;
}

function valorDoCampo(input: RenderInput, id: string): string | undefined {
  const encontrado = campoPorId(input, id);
  if (!encontrado || encontrado.hidden) return undefined;
  const texto = answerText(encontrado);
  return texto.length > 0 ? texto : undefined;
}

function formatCivil(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * Tira a pontuação final de um trecho que vai no meio de uma frase.
 *
 * O campo "referente a" é escrito como frase e costuma terminar em ponto;
 * costurado à cláusula de quitação, ele produzia "conforme OS-000072., dando
 * plena quitação" — com o ponto no meio da oração.
 */
function semPontoFinal(texto: string): string {
  return texto.replace(/[.;,\s]+$/, '');
}

/**
 * Primeira letra em minúscula, para a frase costurada não ficar com maiúscula
 * no meio: "referente a Serviços técnicos" vira "referente a serviços
 * técnicos". Sigla em caixa alta fica como está — "referente a pMOC" seria
 * pior que a maiúscula.
 */
function minuscula(texto: string): string {
  if (texto.length < 2) return texto.toLowerCase();
  const duasPrimeiras = texto.slice(0, 2);
  if (duasPrimeiras === duasPrimeiras.toUpperCase()) return texto;
  return texto.charAt(0).toLowerCase() + texto.slice(1);
}

function formatDateTime(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Recife',
  }).format(data);
}
