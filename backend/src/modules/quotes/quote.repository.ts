/**
 * Persistência do Commercial Engine.
 *
 * ## Toda conta é do Postgres
 *
 * O total de um item é `ROUND(quantidade × preço, 2) − desconto`, e essa
 * expressão está gravada em um `CHECK` da tabela. Calcular o mesmo valor em
 * JavaScript exigiria reproduzir o arredondamento do `numeric` do Postgres em
 * ponto flutuante — e no dia em que as duas implementações discordassem em um
 * centavo, o banco recusaria a escrita com uma violação de constraint que
 * ninguém saberia explicar.
 *
 * Por isso item e totais do orçamento são calculados **em SQL**, pelo mesmo
 * motor que os valida. As três instruções cruas deste arquivo existem só para
 * isso.
 *
 * ## Expiração acontece antes de olhar
 *
 * `expireStale` roda no começo de toda leitura e de toda transição. É o mesmo
 * padrão de `IdentityRepository.listInvitations`: a plataforma não tem
 * scheduler, e um orçamento que ninguém abriu não precisa mudar de estado —
 * precisa apenas nunca ser **observado** como válido depois do prazo.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationHelper, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import { DomainEventEmitter } from '../automations/domain-event.emitter';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES } from '../jobs/background-job.types';
import type { QuoteQueryDto } from './quote.dto';
import { allocateServiceOrderNumber } from '../operations/service-order-number';

const actor = { select: { id: true, displayName: true } } as const;

const itemView = {
  id: true,
  kind: true,
  description: true,
  sku: true,
  unit: true,
  quantity: true,
  unitPrice: true,
  discount: true,
  total: true,
  notes: true,
  position: true,
  catalogItemId: true,
} satisfies Prisma.QuoteItemSelect;

const quoteView = {
  id: true,
  number: true,
  code: true,
  status: true,
  title: true,
  notes: true,
  introText: true,
  validUntil: true,
  currency: true,
  subtotal: true,
  discount: true,
  discountReason: true,
  total: true,
  sentAt: true,
  decidedAt: true,
  closingReason: true,
  expiredAt: true,
  cancelledAt: true,
  convertedAt: true,
  /** Escalar além da relação: a conversão é decidida por ele, não pelo `include`. */
  operationId: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, legalName: true, tradeName: true } },
  businessUnit: { select: { id: true, legalName: true, tradeName: true } },
  operation: { select: { id: true, code: true, title: true } },
  createdBy: actor,
  sentBy: actor,
  decidedBy: actor,
  responsible: actor,
  serviceAddress: {
    select: {
      id: true,
      label: true,
      street: true,
      number: true,
      complement: true,
      district: true,
      city: true,
      stateCode: true,
    },
  },
  /*
   * Os equipamentos vêm na **listagem**, ao contrário dos itens.
   *
   * São poucos por proposta e são coluna da tabela — a pergunta que o cliente
   * faz primeiro numa proposta de manutenção é *quais aparelhos*. Deixá-los
   * fora obrigaria uma consulta por linha para desenhar a lista.
   */
  assets: {
    select: {
      asset: {
        select: { id: true, name: true, identifier: true, location: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  _count: { select: { items: true } },
} satisfies Prisma.QuoteSelect;

const detailView = {
  ...quoteView,
  items: { select: itemView, orderBy: { position: 'asc' } },
} satisfies Prisma.QuoteSelect;

export type QuoteRecord = Prisma.QuoteGetPayload<{ select: typeof quoteView }>;
export type QuoteDetailRecord = Prisma.QuoteGetPayload<{
  select: typeof detailView;
}>;

export interface CreateQuoteData {
  organizationId: string;
  businessUnitId: string;
  customerId: string;
  title: string;
  notes?: string | null;
  introText?: string | null;
  validUntil?: Date | null;
  currency: string;
  createdById: string;
  serviceAddressId?: string | null;
  responsibleUserId?: string | null;
  /** Equipamentos cobertos, já validados como do mesmo inquilino. */
  assetIds?: readonly string[];
}

export interface ItemSnapshot {
  catalogItemId: string | null;
  kind: string;
  description: string;
  sku: string | null;
  unit: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  notes?: string | null;
}

@Injectable()
export class QuoteRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly jobs: BackgroundJobQueue,
    private readonly events: DomainEventEmitter,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Leitura                                                           */
  /* ---------------------------------------------------------------- */

  list(organizationId: string, query: QuoteQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where = this.where(organizationId, query);

    return this.rls.run(async (tx) => {
      await this.expireStale(tx, organizationId);
      const data = await tx.quote.findMany({
        where,
        select: quoteView,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.quote.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  /**
   * Tudo o que a proposta impressa mostra, numa leitura.
   *
   * Projeção própria porque o documento precisa do que a tela não mostra: o
   * CNPJ do cliente para a proposta ter valor comercial, o endereço do
   * atendimento, e a identidade completa de quem emite — timbre, endereço e
   * contato. Alargar `detailView` faria toda listagem carregar isso.
   */
  /**
   * A proposta como o documento emitido precisa dela.
   *
   * Parecido com `documentSource`, e separado dele de propósito: aquele alimenta
   * um PDF e por isso carrega logo, assinatura e endereço do emissor; este
   * alimenta uma **execução de artefato** e precisa das chaves que o PDF ignora —
   * unidade, cliente e atendimento são colunas da execução, não linhas do papel.
   * Juntar os dois faria cada emissão carregar bytes de imagem sem uso.
   */
  emissionSource(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.quote.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          id: true,
          businessUnitId: true,
          customerId: true,
          operationId: true,
          responsibleUserId: true,
          code: true,
          status: true,
          title: true,
          notes: true,
          introText: true,
          discountReason: true,
          validUntil: true,
          total: true,
          sentAt: true,
          createdAt: true,
          responsible: { select: { displayName: true } },
          serviceAddress: {
            select: {
              street: true,
              number: true,
              complement: true,
              district: true,
              city: true,
              stateCode: true,
            },
          },
          items: {
            orderBy: { position: 'asc' as const },
            select: {
              description: true,
              unit: true,
              quantity: true,
              unitPrice: true,
              total: true,
              notes: true,
            },
          },
          customer: {
            select: {
              legalName: true,
              tradeName: true,
              documentType: true,
              documentNumber: true,
              addresses: {
                where: { isPrimary: true, isActive: true },
                take: 1,
                select: {
                  street: true,
                  number: true,
                  complement: true,
                  district: true,
                  city: true,
                  stateCode: true,
                },
              },
            },
          },
        },
      }),
    );
  }

  documentSource(id: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          code: true,
          status: true,
          title: true,
          notes: true,
          validUntil: true,
          subtotal: true,
          discount: true,
          discountReason: true,
          total: true,
          sentAt: true,
          decidedAt: true,
          createdAt: true,
          introText: true,
          createdBy: { select: { displayName: true } },
          operation: { select: { code: true, title: true } },
          /*
           * O endereço **escolhido**, além do principal do cliente.
           *
           * Os dois vêm porque a proposta pode não ter escolhido nenhum — as
           * que nasceram antes deste campo não escolheram — e aí o principal
           * segue valendo. Com escolha, ela vence: era o defeito de imprimir
           * `addresses[0]` para quem tem duas filiais.
           */
          serviceAddress: {
            select: {
              label: true,
              street: true,
              number: true,
              complement: true,
              district: true,
              city: true,
              stateCode: true,
              postalCode: true,
            },
          },
          /*
           * A assinatura ativa de quem responde.
           *
           * `active` e `revokedAt: null` no `where`: uma assinatura revogada é
           * exatamente a que não pode sair impressa. `take: 1` porque o índice
           * único garante uma ativa por pessoa.
           */
          responsible: {
            select: {
              displayName: true,
              professionalSignatures: {
                where: { active: true, revokedAt: null },
                orderBy: { version: 'desc' as const },
                take: 1,
                select: {
                  storageObject: {
                    select: {
                      bucket: true,
                      objectKey: true,
                      mimeType: true,
                    },
                  },
                },
              },
            },
          },
          assets: {
            orderBy: { createdAt: 'asc' as const },
            select: {
              asset: {
                select: { name: true, identifier: true, location: true },
              },
            },
          },
          items: {
            orderBy: { position: 'asc' as const },
            select: {
              kind: true,
              description: true,
              sku: true,
              unit: true,
              quantity: true,
              unitPrice: true,
              discount: true,
              total: true,
              notes: true,
            },
          },
          customer: {
            select: {
              legalName: true,
              tradeName: true,
              documentType: true,
              documentNumber: true,
              email: true,
              phone: true,
              addresses: {
                where: { isPrimary: true, isActive: true },
                take: 1,
                select: {
                  label: true,
                  street: true,
                  number: true,
                  complement: true,
                  district: true,
                  city: true,
                  stateCode: true,
                  postalCode: true,
                },
              },
            },
          },
          businessUnit: {
            select: {
              legalName: true,
              tradeName: true,
              documentType: true,
              documentNumber: true,
              email: true,
              phone: true,
              website: true,
              logoUrl: true,
              /* A marca da empresa, para quando a unidade não tiver a sua.
                 `issuerLogo` decide; aqui só se garante que o dado chegue. */
              organization: { select: { logoUrl: true } },
              street: true,
              number: true,
              district: true,
              city: true,
              stateCode: true,
              timezone: true,
            },
          },
        },
      });
      return quote;
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      await this.expireStale(tx, organizationId);
      return tx.quote.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: detailView,
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Criação                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Cria o orçamento com o próximo número da organização.
   *
   * A numeração é atribuída sob `pg_advisory_xact_lock`, como a revisão do
   * manifest: duas propostas criadas no mesmo instante não podem receber o
   * mesmo número, porque é por ele que o cliente se refere ao documento. A
   * trava usa `$executeRaw` — `pg_advisory_xact_lock` devolve `void`, e
   * `$queryRaw` falha ao desserializar.
   */
  create(data: CreateQuoteData) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote:${data.organizationId}`}))`;

      const latest = await tx.quote.aggregate({
        where: { organizationId: data.organizationId },
        _max: { number: true },
      });
      const number = (latest._max.number ?? 0) + 1;

      const quote = await tx.quote.create({
        data: {
          id: generateUuidV7(),
          organizationId: data.organizationId,
          businessUnitId: data.businessUnitId,
          customerId: data.customerId,
          number,
          code: `ORC-${`${number}`.padStart(6, '0')}`,
          title: data.title,
          notes: data.notes ?? null,
          introText: data.introText ?? null,
          validUntil: data.validUntil ?? null,
          currency: data.currency,
          createdById: data.createdById,
          serviceAddressId: data.serviceAddressId ?? null,
          /* Quem digita responde, a não ser que digam outro. Nulo aqui faria o
             documento sair sem assinatura — e o serviço já resolveu o padrão. */
          responsibleUserId: data.responsibleUserId ?? data.createdById,
          assets:
            data.assetIds && data.assetIds.length > 0
              ? {
                  create: data.assetIds.map((assetId) => ({
                    id: generateUuidV7(),
                    assetId,
                  })),
                }
              : undefined,
        },
        select: detailView,
      });

      await this.audit(
        tx,
        data.organizationId,
        data.businessUnitId,
        data.createdById,
        'QUOTE_CREATED',
        quote.id,
        null,
        { number, code: quote.code, customerId: data.customerId },
      );

      return quote;
    });
  }

  /**
   * Edita o rascunho.
   *
   * `discount` **não** viaja no `update` do Prisma: gravá-lo sozinho deixaria
   * `total` desatualizado por um instante, e o `CHECK`
   * `total = subtotal - discount` é avaliado a cada instrução — a escrita
   * falharia com violação de constraint antes de o recálculo acontecer. O
   * desconto entra pelo `recalculate`, que ajusta os três valores de uma vez.
   */
  update(
    id: string,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    /* `Unchecked` e não `QuoteUpdateInput`: quem chama trabalha com ids —
       `serviceAddressId`, `responsibleUserId` — e a forma de relação obrigaria
       o serviço a montar `connect` para dados que ele já validou como ids. */
    data: Prisma.QuoteUncheckedUpdateInput,
    before: Record<string, unknown>,
    discount?: string,
    /**
     * O conjunto inteiro de equipamentos, quando informado.
     *
     * Substitui, não acrescenta: `undefined` deixa como está, e uma lista vazia
     * limpa. Sem essa distinção não haveria como remover o último equipamento —
     * "vazio" e "não mencionado" chegariam iguais.
     */
    assetIds?: readonly string[],
  ) {
    return this.rls.run(async (tx) => {
      await tx.quote.update({ where: { id }, data });
      if (assetIds) {
        await tx.quoteAsset.deleteMany({ where: { quoteId: id } });
        if (assetIds.length > 0) {
          await tx.quoteAsset.createMany({
            data: assetIds.map((assetId) => ({
              id: generateUuidV7(),
              quoteId: id,
              assetId,
            })),
          });
        }
      }
      await this.recalculate(tx, id, discount);
      const quote = await this.reload(tx, id);

      await this.audit(
        tx,
        organizationId,
        businessUnitId,
        actorId,
        'QUOTE_UPDATED',
        id,
        before,
        {
          title: quote.title,
          discount: quote.discount.toString(),
          total: quote.total.toString(),
        },
      );
      return quote;
    });
  }

  softDelete(
    id: string,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
  ) {
    return this.rls
      .run(async (tx) => {
        await tx.quote.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        await this.audit(
          tx,
          organizationId,
          businessUnitId,
          actorId,
          'QUOTE_DELETED',
          id,
          null,
          null,
        );
      })
      .then(() => undefined);
  }

  /* ---------------------------------------------------------------- */
  /* Itens                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Acrescenta um item já congelado.
   *
   * O `total` é calculado pelo Postgres, na mesma expressão do `CHECK` — ver o
   * cabeçalho. `position` é o próximo da lista, para que a ordem de leitura
   * seja a ordem em que a proposta foi montada.
   */
  addItem(
    quoteId: string,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    snapshot: ItemSnapshot,
  ) {
    return this.rls.run(async (tx) => {
      const position = await tx.quoteItem.aggregate({
        where: { quoteId },
        _max: { position: true },
      });

      const id = generateUuidV7();
      await tx.$executeRaw`
        INSERT INTO quote_items (
          id, organization_id, quote_id, catalog_item_id, kind, description,
          sku, unit, quantity, unit_price, discount, total, notes, position,
          updated_at
        ) VALUES (
          ${id}::uuid,
          ${organizationId}::uuid,
          ${quoteId}::uuid,
          ${snapshot.catalogItemId}::uuid,
          ${snapshot.kind},
          ${snapshot.description},
          ${snapshot.sku},
          ${snapshot.unit},
          ${snapshot.quantity}::decimal,
          ${snapshot.unitPrice}::decimal,
          ${snapshot.discount}::decimal,
          ROUND(${snapshot.quantity}::decimal * ${snapshot.unitPrice}::decimal, 2)
            - ${snapshot.discount}::decimal,
          ${snapshot.notes ?? null},
          ${(position._max.position ?? 0) + 1},
          now()
        )
      `;

      await this.recalculate(tx, quoteId);
      const quote = await this.reload(tx, quoteId);

      await this.audit(
        tx,
        organizationId,
        businessUnitId,
        actorId,
        'QUOTE_ITEM_ADDED',
        quoteId,
        null,
        {
          itemId: id,
          description: snapshot.description,
          quantity: snapshot.quantity,
          unitPrice: snapshot.unitPrice,
          total: quote.total.toString(),
        },
      );

      return quote;
    });
  }

  updateItem(
    itemId: string,
    quoteId: string,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    patch: {
      description?: string;
      unit?: string;
      quantity?: string;
      unitPrice?: string;
      discount?: string;
      notes?: string | null;
    },
    before: Record<string, unknown>,
  ) {
    return this.rls.run(async (tx) => {
      /**
       * Uma instrução só, e o total junto.
       *
       * `COALESCE` atualiza apenas o que veio; o total é recomputado **na
       * mesma linha do `SET`**, a partir dos valores novos. Fazê-lo em duas
       * instruções deixaria a primeira com quantidade nova e total velho — e o
       * `CHECK` `total = ROUND(quantity * unit_price, 2) - discount` é
       * avaliado a cada instrução, então a escrita falharia antes de o
       * recálculo acontecer.
       */
      await tx.$executeRaw`
        UPDATE quote_items SET
          description = COALESCE(${patch.description ?? null}, description),
          unit        = COALESCE(${patch.unit ?? null}, unit),
          quantity    = COALESCE(${patch.quantity ?? null}::decimal, quantity),
          unit_price  = COALESCE(${patch.unitPrice ?? null}::decimal, unit_price),
          discount    = COALESCE(${patch.discount ?? null}::decimal, discount),
          notes       = COALESCE(${patch.notes ?? null}, notes),
          total       = ROUND(
                          COALESCE(${patch.quantity ?? null}::decimal, quantity)
                          * COALESCE(${patch.unitPrice ?? null}::decimal, unit_price),
                          2
                        ) - COALESCE(${patch.discount ?? null}::decimal, discount),
          updated_at  = now()
        WHERE id = ${itemId}::uuid
      `;

      await this.recalculate(tx, quoteId);
      const quote = await this.reload(tx, quoteId);

      await this.audit(
        tx,
        organizationId,
        businessUnitId,
        actorId,
        'QUOTE_ITEM_UPDATED',
        quoteId,
        before,
        { itemId, total: quote.total.toString() },
      );
      return quote;
    });
  }

  removeItem(
    itemId: string,
    quoteId: string,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    before: Record<string, unknown>,
  ) {
    return this.rls.run(async (tx) => {
      await tx.quoteItem.delete({ where: { id: itemId } });
      await this.recalculate(tx, quoteId);
      const quote = await this.reload(tx, quoteId);

      await this.audit(
        tx,
        organizationId,
        businessUnitId,
        actorId,
        'QUOTE_ITEM_REMOVED',
        quoteId,
        before,
        { itemId, total: quote.total.toString() },
      );
      return quote;
    });
  }

  findItem(itemId: string, quoteId: string) {
    return this.rls.run((tx) =>
      tx.quoteItem.findFirst({
        where: { id: itemId, quoteId },
        select: itemView,
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Transições                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Aplica uma transição de estado.
   *
   * `where` inclui o status de origem: se outra requisição já mudou o estado,
   * `updateMany` afeta zero linhas e a transição é recusada. É a proteção
   * contra a corrida de dois cliques em "aprovar" — sem ela, o segundo
   * sobrescreveria autor e data do primeiro.
   *
   * `event` enfileira o fato **dentro da mesma transação**: ou o orçamento
   * muda de estado e o evento existe, ou nenhum dos dois. Fora dela, um
   * processo que morresse entre o commit e o enfileiramento deixaria uma
   * proposta aprovada sem a receita prevista correspondente — perda silenciosa.
   */
  transition(input: {
    id: string;
    organizationId: string;
    businessUnitId: string;
    actorId: string;
    from: readonly string[];
    to: string;
    /**
     * `Unchecked` porque a transição grava chaves estrangeiras diretamente
     * (`sentById`, `decidedById`): o formulário "checked" do Prisma não as
     * aceita em `updateMany`, e conectar relação exigiria `update` — que não
     * tem `where` composto, e é justamente o `where` que evita a corrida.
     */
    data: Prisma.QuoteUncheckedUpdateManyInput;
    action: string;
    details?: Record<string, unknown>;
    event?: boolean;
  }) {
    return this.rls.run(async (tx) => {
      const changed = await tx.quote.updateMany({
        where: {
          id: input.id,
          organizationId: input.organizationId,
          status: { in: [...input.from] },
          deletedAt: null,
        },
        data: { ...input.data, status: input.to },
      });
      if (changed.count === 0) return null;

      await this.audit(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.actorId,
        input.action,
        input.id,
        { from: input.from },
        { status: input.to, ...(input.details ?? {}) },
      );

      /**
       * Aprovação também é evento de domínio.
       *
       * A fila `quote.status.changed` continua existindo para o efeito
       * financeiro — ela nasceu antes do motor e tem consumidor próprio. O
       * evento é para **automação**: são coisas diferentes, e fundi-las faria a
       * receita prevista depender de o motor estar de pé.
       */
      if (input.to === 'APPROVED') {
        const approved = await tx.quote.findUniqueOrThrow({
          where: { id: input.id },
          select: {
            customerId: true,
            total: true,
            currency: true,
            createdById: true,
          },
        });
        await this.events.emit(tx, {
          type: 'quote.approved',
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          actorId: input.actorId,
          entityType: 'QUOTE',
          entityId: input.id,
          payload: {
            businessUnitId: input.businessUnitId,
            customerId: approved.customerId,
            total: approved.total.toString(),
            currency: approved.currency,
            createdById: approved.createdById,
          },
        });
      }

      if (input.event) {
        await this.jobs.enqueue(
          {
            queue: JOB_QUEUES.quoteStatusChanged,
            /**
             * A chave inclui o destino: aprovar e depois cancelar são dois
             * eventos distintos do mesmo orçamento, e ambos precisam correr.
             */
            jobKey: `${input.id}:${input.to}`,
            organizationId: input.organizationId,
            scope: 'BUSINESS_UNIT',
            businessUnitId: input.businessUnitId,
            payload: { quoteId: input.id, status: input.to },
            correlationId: generateUuidV7(),
            actorUserId: input.actorId,
          },
          tx,
        );
      }

      return this.reload(tx, input.id);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Conversão                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Cria a operação e a reivindica para este orçamento, numa transação.
   *
   * A corrida é resolvida pelo `WHERE operation_id IS NULL`: duas conversões
   * simultâneas criam duas operações, mas só uma consegue ocupar o campo — e a
   * perdedora vê `count = 0`, lança, e o rollback **desfaz a operação que ela
   * mesma criou**. Nunca sobra ordem de serviço órfã.
   *
   * Devolve `null` quando outra transação venceu.
   */
  convert(input: {
    quoteId: string;
    organizationId: string;
    businessUnitId: string;
    customerId: string;
    actorId: string;
    code: string;
    kind: string;
    priority: string;
    title: string;
    description: string;
    scheduledStart?: Date | null;
    scheduledEnd?: Date | null;
  }) {
    return this.rls.run(async (tx) => {
      /**
       * Serializa as conversões deste orçamento.
       *
       * Sem a trava, requisições simultâneas criam operações com o **mesmo
       * código** — derivado do código do orçamento — e colidem no índice único
       * de `operations`, devolvendo 500 em vez do resultado certo. Com ela, a
       * segunda encontra `operationId` já preenchido e devolve o que existe,
       * sem criar nada para depois desfazer.
       */
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote:convert:${input.quoteId}`}))`;

      const current = await tx.quote.findFirst({
        where: { id: input.quoteId, deletedAt: null },
        select: { operationId: true },
      });
      if (!current) return null;
      if (current.operationId) return this.reload(tx, input.quoteId);

      /* Orçamento aprovado vira ordem de serviço, e ordem de serviço tem número
         próprio — a mesma contagem da criação direta, e não uma paralela. */
      const serviceOrderNumber = await allocateServiceOrderNumber(
        tx,
        input.organizationId,
      );

      const operation = await tx.operation.create({
        data: {
          id: generateUuidV7(),
          organizationId: input.organizationId,
          serviceOrderNumber,
          businessUnitId: input.businessUnitId,
          customerId: input.customerId,
          code: input.code,
          kind: input.kind,
          title: input.title,
          description: input.description,
          status: input.scheduledStart ? 'SCHEDULED' : 'OPEN',
          priority: input.priority,
          scheduledStart: input.scheduledStart ?? null,
          scheduledEnd: input.scheduledEnd ?? null,
          createdById: input.actorId,
          /** Rastro do lado da operação: de onde este trabalho veio. */
          data: { quoteId: input.quoteId },
        },
      });

      await tx.operationHistory.create({
        data: {
          operationId: operation.id,
          userId: input.actorId,
          action: 'CREATED',
          toStatus: operation.status,
          details: { quoteId: input.quoteId, origin: 'QUOTE' },
        },
      });

      const claimed = await tx.quote.updateMany({
        where: { id: input.quoteId, operationId: null, deletedAt: null },
        data: { operationId: operation.id, convertedAt: new Date() },
      });
      if (claimed.count === 0) return null;

      await this.audit(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.actorId,
        'QUOTE_CONVERTED',
        input.quoteId,
        null,
        { operationId: operation.id, operationCode: operation.code },
      );

      return this.reload(tx, input.quoteId);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Referências                                                       */
  /* ---------------------------------------------------------------- */

  findBusinessUnit(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.businessUnit.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  findCustomer(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.customer.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  /**
   * O atendimento de onde a proposta vai copiar.
   *
   * Traz o que o orçamento sabe aproveitar: cliente, endereço, equipamentos,
   * título e descrição. `status` vem para que o serviço recuse o que não está
   * concluído — copiar escopo de um atendimento em andamento copiaria algo que
   * ainda vai mudar.
   */
  findOperationSource(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: {
          id: true,
          code: true,
          title: true,
          description: true,
          status: true,
          businessUnitId: true,
          customerId: true,
          customerAddressId: true,
          completedAt: true,
          assets: { select: { assetId: true } },
        },
      }),
    );
  }

  /**
   * O material que o atendimento consumiu, somado por item de catálogo.
   *
   * É a única origem de itens que a operação oferece: ela não guarda linha de
   * serviço com preço — `kind` é categoria, não item de catálogo. Um serviço
   * inventado aqui viraria linha com valor numa proposta que ninguém combinou.
   *
   * Agrupado porque o mesmo material pode sair do estoque em vários movimentos,
   * e a proposta quer uma linha por material, não uma por movimento.
   *
   * Preço **não** vem daqui: o movimento registra custo de estoque, e uma
   * proposta cobra preço de venda. Quem monta o item busca o preço no Catálogo,
   * como faria para um item escolhido à mão.
   */
  findOperationConsumption(operationId: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const grupos = await tx.inventoryMovement.groupBy({
        by: ['catalogItemId'],
        where: { operationId, organizationId, type: 'CONSUMPTION' },
        _sum: { quantity: true },
      });
      return grupos
        .map((grupo) => ({
          catalogItemId: grupo.catalogItemId,
          quantity: grupo._sum.quantity?.toString() ?? '0',
        }))
        .filter((linha) => Number(linha.quantity) > 0);
    });
  }

  /**
   * Endereço do cliente, confirmado como **daquele** cliente.
   *
   * O `customerId` está no `where`, e não conferido depois: um endereço de
   * outro cliente do mesmo inquilino passaria por uma checagem só de
   * organização, e a proposta sairia com o endereço de terceiro.
   */
  findCustomerAddress(id: string, organizationId: string, customerId: string) {
    return this.rls.run((tx) =>
      tx.customerAddress.findFirst({
        where: { id, organizationId, customerId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  /**
   * Quais dos equipamentos pedidos existem no inquilino.
   *
   * Devolve os encontrados em vez de um booleano: quem chama precisa dizer
   * *qual* id não existe, e uma resposta "algum é inválido" mandaria a pessoa
   * conferir cinquenta equipamentos.
   */
  findAssetIds(ids: readonly string[], organizationId: string) {
    return this.rls.run(async (tx) => {
      const found = await tx.asset.findMany({
        where: { id: { in: [...ids] }, organizationId, deletedAt: null },
        select: { id: true },
      });
      return found.map((asset) => asset.id);
    });
  }

  /**
   * Membro ativo da organização, para assinar a proposta.
   *
   * Pela associação, e não pelo `User`: um usuário existe na plataforma inteira,
   * e aceitar qualquer id deixaria uma proposta ser assinada por alguém de outro
   * inquilino.
   */
  findMember(userId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.organizationMembership.findFirst({
        where: { userId, organizationId, deletedAt: null },
        select: { userId: true },
      }),
    );
  }

  /**
   * Item do Catálogo disponível para a unidade.
   *
   * Item restrito a outra unidade não entra: o Catálogo já publica escopo, e
   * ignorá-lo permitiria propor o que aquela filial não oferece.
   */
  findCatalogItem(id: string, organizationId: string, businessUnitId: string) {
    return this.rls.run((tx) =>
      tx.product.findFirst({
        where: {
          id,
          organizationId,
          deletedAt: null,
          OR: [{ businessUnitId: null }, { businessUnitId }],
        },
        select: {
          id: true,
          kind: true,
          name: true,
          sku: true,
          unit: true,
          salePrice: true,
          status: true,
        },
      }),
    );
  }

  /** Próximo código de operação livre para a organização. */
  nextOperationCode(organizationId: string, seed: string) {
    return this.rls.run(async (tx) => {
      const taken = await tx.operation.findFirst({
        where: { organizationId, code: seed, deletedAt: null },
        select: { id: true },
      });
      return taken ? null : seed;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Marca como `EXPIRED` o que passou da validade.
   *
   * Só atinge `SENT`: rascunho não venceu porque nunca foi proposto, e
   * aprovado não vence porque a decisão já aconteceu. `valid_until` é `DATE`,
   * então a comparação é com o dia — a proposta vale até o fim do dia marcado.
   */
  private async expireStale(
    tx: PrismaTransactionClient,
    organizationId: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE quotes
         SET status = 'EXPIRED', expired_at = now(), updated_at = now()
       WHERE organization_id = ${organizationId}::uuid
         AND status = 'SENT'
         AND deleted_at IS NULL
         AND valid_until IS NOT NULL
         AND valid_until < CURRENT_DATE
    `;
  }

  /** Público para que o serviço expire antes de decidir uma transição. */
  expire(organizationId: string): Promise<void> {
    return this.rls
      .run((tx) => this.expireStale(tx, organizationId))
      .then(() => undefined);
  }

  /**
   * Recalcula subtotal e total a partir dos itens.
   *
   * Uma instrução, no banco: somar em JavaScript exigiria trazer os itens para
   * a memória e devolver um número que o `CHECK` da tabela conferiria contra a
   * própria soma — e a chance de discordarem é justamente o que se quer evitar.
   *
   * O desconto do orçamento é aparado ao subtotal. Sem isso, remover itens de
   * uma proposta com desconto grande produziria total negativo e a escrita
   * seria recusada pela constraint, no meio de uma operação que o usuário via
   * como "apagar uma linha".
   */
  private async recalculate(
    tx: PrismaTransactionClient,
    quoteId: string,
    discount?: string,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE quotes q
         SET subtotal = totals.sum,
             discount = LEAST(COALESCE(${discount ?? null}::decimal, q.discount), totals.sum),
             total    = totals.sum
                        - LEAST(COALESCE(${discount ?? null}::decimal, q.discount), totals.sum),
             updated_at = now()
        FROM (
          SELECT COALESCE(SUM(total), 0)::decimal(14,2) AS sum
            FROM quote_items
           WHERE quote_id = ${quoteId}::uuid
        ) AS totals
       WHERE q.id = ${quoteId}::uuid
    `;
  }

  private reload(tx: PrismaTransactionClient, id: string) {
    return tx.quote.findFirstOrThrow({ where: { id }, select: detailView });
  }

  private where(
    organizationId: string,
    query: QuoteQueryDto,
  ): Prisma.QuoteWhereInput {
    return {
      organizationId,
      deletedAt: null,
      status: query.status,
      customerId: query.customerId,
      businessUnitId: query.businessUnitId,
      ...(query.from || query.to
        ? { createdAt: { gte: query.from, lte: query.to } }
        : {}),
      ...(query.validUntilBefore
        ? { validUntil: { lte: query.validUntilBefore } }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private audit(
    tx: PrismaTransactionClient,
    organizationId: string,
    businessUnitId: string,
    actorId: string,
    action: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        businessUnitId,
        userId: actorId,
        action,
        entityType: 'QUOTE',
        entityId,
        before: (before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (after ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
