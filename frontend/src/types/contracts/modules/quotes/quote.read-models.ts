/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

/**
 * Read Models do Commercial Engine.
 *
 * ## Dinheiro viaja como string
 *
 * Pela mesma razão do Financeiro: `Decimal` não cabe em ponto flutuante sem
 * risco de arredondamento, e um centavo perdido na serialização é um centavo
 * que ninguém explica depois. O cliente formata a string; não faz conta com
 * ela — subtotal, desconto e total já vêm calculados.
 *
 * ## O item é uma fotografia
 *
 * Descrição, SKU, unidade e preço do item são o que valia quando ele entrou no
 * orçamento, não o que o Catálogo diz hoje. `catalogItem` existe para
 * rastreabilidade e traz de propósito **apenas o vínculo**: se o produto foi
 * renomeado ou teve o preço alterado, é a fotografia que vale, e mostrar o
 * nome atual ao lado do preço antigo confundiria as duas coisas.
 */

import type { QuoteStatus } from '../..';

export interface QuoteActorReadModel {
  id: string;
  displayName: string;
}

/**
 * O endereço onde o serviço acontece.
 *
 * Publicado inteiro, e não só o id: quem desenha a proposta precisa mostrá-lo,
 * e obrigar uma segunda consulta ao cliente para cada linha da lista trocaria
 * uma resposta por N.
 */
export interface QuoteAddressReadModel {
  id: string;
  label: string;
  /** Uma linha, já montada pelo servidor — a mesma que vai no documento. */
  summary: string;
}

/**
 * Um equipamento coberto pela proposta.
 *
 * Diferente de `QuoteItemReadModel`, aqui **não** é fotografia: o que interessa
 * é qual aparelho, e o cadastro dele é a fonte viva desse dado. Renomear o
 * equipamento deve mudar o que a proposta mostra.
 */
export interface QuoteAssetReadModel {
  id: string;
  name: string;
  identifier: string | null;
  location: string | null;
}

export interface QuoteItemReadModel {
  id: string;
  /** `PRODUCT` · `SERVICE` · `PART`, congelado na inclusão. */
  kind: string;
  description: string;
  sku: string | null;
  unit: string;
  /** Decimal com três casas, em string. */
  quantity: string;
  unitPrice: string;
  discount: string;
  /** `quantity × unitPrice − discount`, calculado pelo servidor. */
  total: string;
  notes: string | null;
  position: number;
  /** Vínculo com o Catálogo. `null` quando o item foi digitado à mão. */
  catalogItemId: string | null;
}

/**
 * Ações possíveis **agora**, decididas pelo servidor.
 *
 * A máquina de estados vive no backend, e publicá-la assim evita que cada
 * cliente reimplemente as transições — que é como duas interfaces passam a
 * discordar sobre o que um orçamento aceita. É descrição, não autorização: a
 * permissão continua sendo verificada a cada requisição.
 */
export interface QuoteTransitionsReadModel {
  canEdit: boolean;
  canSend: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  canConvert: boolean;
}

export interface QuoteReadModel {
  id: string;
  /** Sequencial da organização; é por ele que o cliente se refere à proposta. */
  number: number;
  code: string;
  status: QuoteStatus;
  title: string;
  notes: string | null;
  /** Parágrafo de abertura. `null` imprime o padrão do documento. */
  introText: string | null;
  /** `YYYY-MM-DD`. Validade é dia, não instante. */
  validUntil: string | null;
  /**
   * A validade já passou.
   *
   * Calculado **no servidor**, contra o relógio do servidor. Um navegador com
   * a data errada não decide se uma proposta ainda vale.
   */
  isExpired: boolean;
  currency: string;
  subtotal: string;
  discount: string;
  /** Por que houve desconto. `null` quando não houve, ou quando não se disse. */
  discountReason: string | null;
  total: string;
  customer: { id: string; displayName: string };
  businessUnit: { id: string; name: string };
  /** Endereço de execução escolhido. `null` quando não foi informado. */
  serviceAddress: QuoteAddressReadModel | null;
  /**
   * Quem responde pela proposta, e de quem sai a assinatura impressa.
   *
   * Separado de `createdBy`: quem digita não é necessariamente quem assina.
   */
  responsible: QuoteActorReadModel | null;
  /**
   * Os equipamentos cobertos.
   *
   * Vem na **listagem** também, ao contrário dos itens: é coluna da tabela e a
   * pergunta que o cliente faz primeiro numa proposta de manutenção. São
   * poucos por proposta, e o custo é o de um `join`.
   */
  assets: QuoteAssetReadModel[];
  items: QuoteItemReadModel[];
  itemCount: number;
  transitions: QuoteTransitionsReadModel;
  /** Operação gerada pela conversão. `null` enquanto não converteu. */
  operation: { id: string; code: string; title: string } | null;
  convertedAt: string | null;
  sentAt: string | null;
  sentBy: QuoteActorReadModel | null;
  decidedAt: string | null;
  decidedBy: QuoteActorReadModel | null;
  /** Motivo da recusa ou do cancelamento. Preservado; edição não o apaga. */
  closingReason: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  createdBy: QuoteActorReadModel;
  createdAt: string;
  updatedAt: string;
}

/**
 * Item de listagem.
 *
 * Sem `items`: uma página de vinte orçamentos com todos os itens de cada um é
 * um payload que cresce sem que ninguém tenha pedido. Quem precisa dos itens
 * abre o orçamento.
 *
 * `assets` **fica**: é coluna da tabela, e são poucos por proposta. Tirar os
 * itens e manter os equipamentos não é inconsistência — é a diferença entre o
 * que a linha mostra e o que só o detalhe precisa.
 */
export type QuoteSummaryReadModel = Omit<QuoteReadModel, 'items'>;
