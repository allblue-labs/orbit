import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { DomainEventEmitter } from '../automations/domain-event.emitter';
import { PaginationHelper } from '../../database/helpers/database.helpers';
import type { OperationQueryDto } from './dto/operation.dto';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { allocateServiceOrderNumber } from './service-order-number';

const operationInclude = {
  businessUnit: {
    select: { id: true, legalName: true, tradeName: true },
  },
  customer: {
    select: { id: true, legalName: true, tradeName: true },
  },
  /**
   * Os equipamentos do atendimento.
   *
   * Era um só (`assetId`). Um atendimento em campo raramente toca um
   * equipamento: o técnico vai ao endereço e atende os aparelhos que estão lá.
   */
  assets: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      assetId: true,
      asset: {
        select: { id: true, name: true, identifier: true, status: true },
      },
    },
  },
  customerAddress: {
    select: {
      id: true,
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
  responsibleFieldTechnician: {
    select: { id: true, displayName: true, avatarUrl: true },
  },
  authorizedBy: { select: { id: true, displayName: true, avatarUrl: true } },
  startedBy: { select: { id: true, displayName: true, avatarUrl: true } },
  completedBy: { select: { id: true, displayName: true, avatarUrl: true } },
  auxiliaryTechnicians: {
    where: { removedAt: null },
    select: {
      id: true,
      userId: true,
      assignedById: true,
      assignedAt: true,
      user: { select: { id: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { assignedAt: 'asc' as const },
  },
  users: {
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
    orderBy: { assignedAt: 'asc' },
  },
  attachments: {
    where: { deletedAt: null },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      size: true,
      checksum: true,
      uploadedById: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  },
  checklistExecutions: {
    select: {
      id: true,
      templateId: true,
      templateVersion: true,
      status: true,
      progress: true,
      completedAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.OperationInclude;

@Injectable()
export class OperationRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly events: DomainEventEmitter,
  ) {}

  list(organizationId: string, query: OperationQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.OperationWhereInput = {
      organizationId,
      deletedAt: null,
      businessUnitId: query.businessUnitId,
      customerId: query.customerId,
      /** Filtrar por equipamento agora atravessa o vínculo. */
      ...(query.assetId
        ? { assets: { some: { assetId: query.assetId } } }
        : {}),
      kind: query.kind,
      status: query.status,
      priority: query.priority,
      scheduledStart:
        query.scheduledFrom || query.scheduledTo
          ? { gte: query.scheduledFrom, lte: query.scheduledTo }
          : undefined,
      /**
       * Atribuída e ainda não autorizada — a fila da aba Autorização.
       *
       * "Atribuída" é ter responsável: é o responsável que executa, e é a
       * autorização dele que o aplicativo exige. Auxiliar sem responsável não
       * existe (o serviço recusa), então não há caso a cobrir.
       *
       * O recorte é do servidor para a contagem ser verdade: filtrar uma página no
       * navegador diria "3 pendentes" numa organização com duzentas.
       */
      ...(query.pendingAuthorization
        ? {
            authorizedAt: null,
            responsibleFieldTechnicianId: { not: null },
          }
        : {}),
      /**
       * Dois filtros, duas condições — e as duas valem.
       *
       * Atribuição e busca escreviam a mesma chave `OR` no mesmo objeto, e a
       * segunda apagava a primeira: pedir "os de Eduardo" **e** um termo devolvia
       * qualquer atendimento que combinasse com o termo, de quem fosse. Dentro de
       * `AND` cada uma continua sendo um `OR` próprio, e as duas são exigidas.
       */
      AND: [
        ...(query.assignedUserId
          ? [
              {
                OR: [
                  { responsibleFieldTechnicianId: query.assignedUserId },
                  {
                    auxiliaryTechnicians: {
                      some: { userId: query.assignedUserId, removedAt: null },
                    },
                  },
                  { users: { some: { userId: query.assignedUserId } } },
                ],
              },
            ]
          : []),
        ...(query.search
          ? [
              {
                OR: [
                  {
                    code: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    title: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    description: {
                      contains: query.search,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    return this.rls.run(async (transaction) => {
      const data = await transaction.operation.findMany({
        where,
        include: operationInclude,
        orderBy: [{ scheduledStart: 'asc' }, { createdAt: 'desc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await transaction.operation.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.operation.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: operationInclude,
      }),
    );
  }

  create(
    data: Prisma.OperationUncheckedCreateInput,
    userId: string,
    details: Prisma.InputJsonValue,
    auxiliaryUserIds: string[] = [],
    assetIds: readonly string[] = [],
  ) {
    return this.rls.run((transaction) =>
      this.createWithin(
        transaction,
        data,
        userId,
        details,
        auxiliaryUserIds,
        assetIds,
      ),
    );
  }

  /**
   * Transaction-aware creation boundary used by aggregates that must create an
   * Operation atomically with their own transition (for example PR-34).
   */
  async createWithin(
    transaction: PrismaTransactionClient,
    data: Prisma.OperationUncheckedCreateInput,
    userId: string,
    details: Prisma.InputJsonValue,
    auxiliaryUserIds: string[] = [],
    assetIds: readonly string[] = [],
  ) {
    /*
     * O número da ordem é reservado **aqui**, e não no serviço.
     *
     * Esta é a fronteira por onde toda ordem de serviço nasce — a criação direta
     * e a conversão de uma solicitação do cliente. O PMOC e a RVT criam operação
     * sem passar por aqui, e é assim que ficam de fora da contagem sem precisar
     * de uma condição que alguém possa esquecer de repetir.
     */
    const serviceOrderNumber = await allocateServiceOrderNumber(
      transaction,
      String(data.organizationId),
    );

    const operation = await transaction.operation.create({
      data: {
        ...data,
        serviceOrderNumber,
        /** Os equipamentos entram na mesma transação da ordem. */
        assets: assetIds.length
          ? { create: assetIds.map((assetId) => ({ assetId })) }
          : undefined,
        auxiliaryTechnicians: auxiliaryUserIds.length
          ? {
              create: auxiliaryUserIds.map((auxiliaryUserId) => ({
                organizationId: data.organizationId,
                userId: auxiliaryUserId,
                assignedById: userId,
              })),
            }
          : undefined,
      },
      include: operationInclude,
    });
    /**
     * Quem foi atribuído também entra na participação.
     *
     * `operation_users` é a tabela genérica de "quem está neste atendimento", e é
     * dela que saem o relatório de equipe e os KPIs de produtividade. O modelo de
     * campo — `responsible_field_technician_id` e `operation_auxiliary_technicians` —
     * é o que diz **em qual papel**.
     *
     * A criação direta gravava só o segundo. O efeito era um atendimento com técnico
     * atribuído, chegando no celular dele, que a listagem mostrava como "Sem
     * técnico" e o relatório de equipe contava como zero atribuições. O PMOC já
     * grava as duas coisas (`pmoc.repository`), e esta é a mesma regra na porta que
     * faltava.
     *
     * Os auxiliares entram também: a pergunta do relatório é "quantos atendimentos
     * esta pessoa tem", e quem acompanha tem.
     */
    const participantes = [
      ...(data.responsibleFieldTechnicianId
        ? [String(data.responsibleFieldTechnicianId)]
        : []),
      ...auxiliaryUserIds,
    ];
    if (participantes.length) {
      await transaction.operationUser.createMany({
        /* `new Set` porque o mesmo id nos dois papéis violaria a única
           `(operationId, userId)` — o serviço já recusa, e aqui a escrita não
           depende de ele ter recusado. */
        data: [...new Set(participantes)].map((participanteId) => ({
          operationId: operation.id,
          userId: participanteId,
          assignedById: userId,
        })),
        skipDuplicates: true,
      });
    }

    await transaction.operationHistory.create({
      data: {
        operationId: operation.id,
        userId,
        action: 'CREATED',
        toStatus: operation.status,
        details,
      },
    });

    /** Ponto autoritativo: é aqui que uma ordem de serviço passa a existir. */
    await this.events.emit(transaction, {
      type: 'operation.created',
      organizationId: operation.organizationId,
      businessUnitId: operation.businessUnitId,
      actorId: userId,
      entityType: 'OPERATION',
      entityId: operation.id,
      payload: {
        kind: operation.kind,
        status: operation.status,
        priority: operation.priority,
        businessUnitId: operation.businessUnitId,
        customerId: operation.customerId,
        createdById: operation.createdById,
      },
    });

    return operation;
  }

  replaceResponsibleFieldTechnician(
    id: string,
    organizationId: string,
    previousUserId: string | null,
    newUserId: string,
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      await tx.operationAuxiliaryTechnician.updateMany({
        where: { operationId: id, userId: newUserId, removedAt: null },
        data: { removedAt: new Date(), removedById: actorId },
      });
      const operation = await tx.operation.update({
        where: { id },
        data: { responsibleFieldTechnicianId: newUserId },
        include: operationInclude,
      });
      await this.registrarParticipacao(tx, id, newUserId, actorId);
      const eventIds = (
        await tx.schedulingEvent.findMany({
          where: {
            organizationId,
            sourceModule: 'operations',
            sourceEntityType: 'OPERATION',
            sourceEntityId: id,
            deletedAt: null,
          },
          select: { id: true },
        })
      ).map((event) => event.id);
      if (eventIds.length) {
        await tx.schedulingResourceAllocation.updateMany({
          where: {
            eventId: { in: eventIds },
            deletedAt: null,
            OR: [
              { role: 'RESPONSIBLE_FIELD_TECHNICIAN' },
              { userId: newUserId, role: 'AUXILIARY_TECHNICIAN' },
            ],
          },
          data: { deletedAt: new Date(), status: 'RELEASED' },
        });
        await tx.schedulingResourceAllocation.createMany({
          data: eventIds.map((eventId) => ({
            eventId,
            resourceType: 'USER',
            userId: newUserId,
            role: 'RESPONSIBLE_FIELD_TECHNICIAN',
          })),
        });
      }
      const details = { previousUserId, newUserId };
      await tx.operationHistory.create({
        data: {
          operationId: id,
          userId: actorId,
          action: 'RESPONSIBLE_FIELD_TECHNICIAN_REPLACED',
          details,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          businessUnitId: operation.businessUnitId,
          userId: actorId,
          action: 'operation.responsible.changed',
          entityType: 'OPERATION',
          entityId: id,
          before: previousUserId
            ? { responsibleFieldTechnicianId: previousUserId }
            : undefined,
          after: { responsibleFieldTechnicianId: newUserId },
        },
      });
      await this.events.emit(tx, {
        type: 'operation.responsible.changed',
        organizationId,
        businessUnitId: operation.businessUnitId,
        actorId,
        entityType: 'OPERATION',
        entityId: id,
        payload: details,
      });
      return operation;
    });
  }

  /**
   * Carimba (ou retira) a autorização da atribuição.
   *
   * Um comando só para os dois sentidos: autorizar e revogar diferem apenas
   * pelo carimbo, e separá-los duplicaria a trilha e o evento por nada.
   *
   * Fica no histórico e na auditoria porque é decisão de quem administra
   * sobre o trabalho de outra pessoa — quando a fila do técnico muda, precisa
   * haver onde ler por quê.
   */
  /**
   * A preferência da organização, lida do campo livre `settings`.
   *
   * Uma consulta enxuta: só o JSON, sem arrastar a organização inteira para
   * decidir um booleano que a fila de campo consulta a cada abertura.
   */
  async organizationSettings(organizationId: string): Promise<unknown> {
    return this.rls.run(async (tx) => {
      const organizacao = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
      });
      return organizacao?.settings ?? null;
    });
  }

  setAuthorization(
    id: string,
    organizationId: string,
    actorId: string,
    autorizar: boolean,
    /**
     * Registrar na trilha?
     *
     * Falso para o carimbo **implícito** — aquele que a atribuição aplica
     * quando a organização não exige autorização. Ninguém decidiu nada ali, e
     * uma linha de "atribuição autorizada" no histórico faria parecer que
     * existe uma etapa que essa organização não pratica.
     */
    registrarTrilha = true,
  ) {
    return this.rls.run(async (tx) => {
      const anterior = await tx.operation.findUniqueOrThrow({
        where: { id },
        select: { authorizedAt: true },
      });
      const authorizedAt = autorizar ? new Date() : null;
      const operation = await tx.operation.update({
        where: { id },
        data: { authorizedAt, authorizedById: autorizar ? actorId : null },
        include: operationInclude,
      });
      const details = {
        authorizedAt: authorizedAt?.toISOString() ?? null,
        previousAuthorizedAt: anterior.authorizedAt?.toISOString() ?? null,
      };
      if (registrarTrilha) {
        await tx.operationHistory.create({
          data: {
            operationId: id,
            userId: actorId,
            action: autorizar
              ? 'ASSIGNMENT_AUTHORIZED'
              : 'ASSIGNMENT_AUTHORIZATION_REVOKED',
            details,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId,
            businessUnitId: operation.businessUnitId,
            userId: actorId,
            action: autorizar
              ? 'operation.assignment.authorized'
              : 'operation.assignment.authorization_revoked',
            entityType: 'OPERATION',
            entityId: id,
            before: { authorizedAt: details.previousAuthorizedAt },
            after: { authorizedAt: details.authorizedAt },
          },
        });
        await this.events.emit(tx, {
          type: autorizar
            ? 'operation.assignment.authorized'
            : 'operation.assignment.authorization_revoked',
          organizationId,
          businessUnitId: operation.businessUnitId,
          actorId,
          entityType: 'OPERATION',
          entityId: id,
          payload: details,
        });
      }
      return operation;
    });
  }

  /**
   * Os atendimentos pedidos que são desta organização, com o que decide a autorização.
   *
   * Uma consulta para conferir trinta ids. Perguntar um por um faria o lote custar
   * trinta viagens para responder "existem e são meus?".
   */
  findIdsWithin(organizationId: string, ids: readonly string[]) {
    return this.rls.run((tx) =>
      tx.operation.findMany({
        where: { organizationId, deletedAt: null, id: { in: [...ids] } },
        select: {
          id: true,
          authorizedAt: true,
          responsibleFieldTechnicianId: true,
        },
      }),
    );
  }

  /**
   * Carimba a autorização de vários atendimentos numa transação.
   *
   * ## Por que a trilha é por atendimento
   *
   * Porque é por atendimento que alguém vai perguntar depois: "quem liberou este
   * trabalho, e quando". Um registro único de "autorizou 30" responderia a pergunta
   * do lote e nenhuma das trinta. Então cada um recebe histórico, auditoria e evento
   * de domínio — o evento é o que avisa o técnico.
   *
   * ## Por que uma transação só
   *
   * Autorizar é liberar trabalho para o campo. Metade liberada, com a tela dizendo
   * que falhou, deixaria o dono sem saber o que já está no celular de quem.
   */
  authorizeMany(
    organizationId: string,
    actorId: string,
    ids: readonly string[],
  ): Promise<number> {
    if (ids.length === 0) return Promise.resolve(0);
    return this.rls.run(async (tx) => {
      const authorizedAt = new Date();
      const alvos = await tx.operation.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, businessUnitId: true },
      });

      await tx.operation.updateMany({
        where: { id: { in: [...ids] } },
        data: { authorizedAt, authorizedById: actorId },
      });

      const details = {
        authorizedAt: authorizedAt.toISOString(),
        previousAuthorizedAt: null,
      };

      await tx.operationHistory.createMany({
        data: alvos.map((alvo) => ({
          operationId: alvo.id,
          userId: actorId,
          action: 'ASSIGNMENT_AUTHORIZED',
          details,
        })),
      });

      await tx.auditLog.createMany({
        data: alvos.map((alvo) => ({
          organizationId,
          businessUnitId: alvo.businessUnitId,
          userId: actorId,
          action: 'operation.assignment.authorized',
          entityType: 'OPERATION',
          entityId: alvo.id,
          before: { authorizedAt: null },
          after: { authorizedAt: details.authorizedAt },
        })),
      });

      /* O evento é o que faz o atendimento aparecer para quem vai executar; um por
         atendimento, como na autorização individual. */
      for (const alvo of alvos) {
        await this.events.emit(tx, {
          type: 'operation.assignment.authorized',
          organizationId,
          businessUnitId: alvo.businessUnitId,
          actorId,
          entityType: 'OPERATION',
          entityId: alvo.id,
          payload: details,
        });
      }

      return alvos.length;
    });
  }

  addAuxiliaryTechnician(
    id: string,
    organizationId: string,
    userId: string,
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      const operation = await tx.operation.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      if (
        await tx.operationAuxiliaryTechnician.findFirst({
          where: { operationId: id, userId, removedAt: null },
        })
      )
        return null;
      await tx.operationAuxiliaryTechnician.create({
        data: {
          organizationId,
          operationId: id,
          userId,
          assignedById: actorId,
        },
      });
      await this.registrarParticipacao(tx, id, userId, actorId);
      const events = await tx.schedulingEvent.findMany({
        where: {
          organizationId,
          sourceModule: 'operations',
          sourceEntityType: 'OPERATION',
          sourceEntityId: id,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (events.length)
        await tx.schedulingResourceAllocation.createMany({
          data: events.map((event) => ({
            eventId: event.id,
            resourceType: 'USER',
            userId,
            role: 'AUXILIARY_TECHNICIAN',
          })),
        });
      await tx.operationHistory.create({
        data: {
          operationId: id,
          userId: actorId,
          action: 'AUXILIARY_TECHNICIAN_ADDED',
          details: { auxiliaryUserId: userId },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          businessUnitId: operation.businessUnitId,
          userId: actorId,
          action: 'operation.auxiliary.added',
          entityType: 'OPERATION',
          entityId: id,
          after: { auxiliaryUserId: userId },
        },
      });
      await this.events.emit(tx, {
        type: 'operation.auxiliary.added',
        organizationId,
        businessUnitId: operation.businessUnitId,
        actorId,
        entityType: 'OPERATION',
        entityId: id,
        payload: { auxiliaryUserId: userId },
      });
      return tx.operation.findUniqueOrThrow({
        where: { id },
        include: operationInclude,
      });
    });
  }

  removeAuxiliaryTechnician(
    id: string,
    organizationId: string,
    userId: string,
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      const operation = await tx.operation.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      const changed = await tx.operationAuxiliaryTechnician.updateMany({
        where: { operationId: id, userId, removedAt: null },
        data: { removedAt: new Date(), removedById: actorId },
      });
      if (!changed.count) return null;
      await tx.schedulingResourceAllocation.updateMany({
        where: {
          userId,
          role: 'AUXILIARY_TECHNICIAN',
          deletedAt: null,
          event: {
            organizationId,
            sourceModule: 'operations',
            sourceEntityType: 'OPERATION',
            sourceEntityId: id,
            deletedAt: null,
          },
        },
        data: { deletedAt: new Date(), status: 'RELEASED' },
      });
      await tx.operationHistory.create({
        data: {
          operationId: id,
          userId: actorId,
          action: 'AUXILIARY_TECHNICIAN_REMOVED',
          details: { auxiliaryUserId: userId },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          businessUnitId: operation.businessUnitId,
          userId: actorId,
          action: 'operation.auxiliary.removed',
          entityType: 'OPERATION',
          entityId: id,
          before: { auxiliaryUserId: userId },
        },
      });
      await this.events.emit(tx, {
        type: 'operation.auxiliary.removed',
        organizationId,
        businessUnitId: operation.businessUnitId,
        actorId,
        entityType: 'OPERATION',
        entityId: id,
        payload: { auxiliaryUserId: userId },
      });
      return tx.operation.findUniqueOrThrow({
        where: { id },
        include: operationInclude,
      });
    });
  }

  update(
    id: string,
    data: Prisma.OperationUpdateInput,
    userId: string,
    details: Prisma.InputJsonValue,
  ) {
    return this.rls.run(async (transaction) => {
      const operation = await transaction.operation.update({
        where: { id },
        data,
        include: operationInclude,
      });
      await transaction.operationHistory.create({
        data: { operationId: id, userId, action: 'UPDATED', details },
      });
      return operation;
    });
  }

  changeStatus(
    id: string,
    fromStatus: string,
    toStatus: string,
    data: Prisma.OperationUncheckedUpdateManyInput,
    userId: string,
    details: Prisma.InputJsonValue,
  ) {
    return this.rls.run(async (transaction) => {
      const changed = await transaction.operation.updateMany({
        where: { id, status: fromStatus, deletedAt: null },
        data,
      });
      if (changed.count !== 1) return null;
      await transaction.operationHistory.create({
        data: {
          operationId: id,
          userId,
          action: 'STATUS_CHANGED',
          fromStatus,
          toStatus,
          details,
        },
      });

      const operation = await transaction.operation.findUniqueOrThrow({
        where: { id },
        include: operationInclude,
      });

      /**
       * Dois eventos, de propósito.
       *
       * `status.changed` cobre qualquer transição; `completed` é publicado à
       * parte porque "quando concluir" é a regra que a operação de campo mais
       * escreve — e obrigá-la a lembrar da condição faria a automação disparar
       * em toda pausa.
       */
      const base = {
        organizationId: operation.organizationId,
        businessUnitId: operation.businessUnitId,
        actorId: userId,
        entityType: 'OPERATION' as const,
        entityId: operation.id,
      };
      const payload = {
        kind: operation.kind,
        status: operation.status,
        fromStatus,
        priority: operation.priority,
        businessUnitId: operation.businessUnitId,
        customerId: operation.customerId,
        assetIds: operation.assets.map((link) => link.assetId),
        createdById: operation.createdById,
      };

      await this.events.emit(transaction, {
        ...base,
        type: 'operation.status.changed',
        payload,
      });

      if (toStatus === 'COMPLETED') {
        await this.events.emit(transaction, {
          ...base,
          type: 'operation.completed',
          payload,
        });
      }

      return operation;
    });
  }

  /**
   * Garante a linha de participação de quem acabou de ser atribuído.
   *
   * `operation_users` é de onde saem o relatório de equipe e os KPIs; o modelo de
   * campo diz o papel. Quem muda um precisa tocar o outro, ou a pessoa aparece no
   * celular e não aparece no relatório — foi o que acontecia.
   *
   * Idempotente: a pessoa pode já constar por ter sido atribuída antes, ou por uma
   * execução de PMOC, e a única `(operationId, userId)` recusaria a segunda linha.
   * `skipDuplicates` é o que torna "garantir" diferente de "inserir".
   */
  private async registrarParticipacao(
    transaction: PrismaTransactionClient,
    operationId: string,
    userId: string,
    assignedById: string,
  ) {
    await transaction.operationUser.createMany({
      data: [{ operationId, userId, assignedById }],
      skipDuplicates: true,
    });
  }

  assign(id: string, userId: string, assignedById: string) {
    return this.rls.run(async (transaction) => {
      const existing = await transaction.operationUser.findUnique({
        where: { operationId_userId: { operationId: id, userId } },
      });
      if (existing) return existing;
      const assignment = await transaction.operationUser.create({
        data: { operationId: id, userId, assignedById },
      });
      await transaction.operationHistory.create({
        data: {
          operationId: id,
          userId: assignedById,
          action: 'USER_ASSIGNED',
          details: { assignedUserId: userId },
        },
      });
      return assignment;
    });
  }

  unassign(id: string, userId: string, assignedById: string): Promise<boolean> {
    return this.rls.run(async (transaction) => {
      const removed = await transaction.operationUser.deleteMany({
        where: { operationId: id, userId },
      });
      if (removed.count !== 1) return false;
      await transaction.operationHistory.create({
        data: {
          operationId: id,
          userId: assignedById,
          action: 'USER_UNASSIGNED',
          details: { assignedUserId: userId },
        },
      });
      return true;
    });
  }

  timeline(id: string) {
    return this.rls.run(async (transaction) => {
      const history = await transaction.operationHistory.findMany({
        where: { operationId: id },
        include: {
          user: {
            select: { id: true, displayName: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        // Workspace overview only. The immutable rows remain in PostgreSQL;
        // a dedicated paginated audit export can expose older history later.
        take: 500,
      });
      const attachments = await transaction.operationAttachment.findMany({
        where: { operationId: id, deletedAt: null },
        include: {
          uploadedBy: {
            select: { id: true, displayName: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { history, attachments };
    });
  }

  createAttachment(
    data: Prisma.OperationAttachmentUncheckedCreateInput,
    actorId: string,
  ) {
    return this.rls.run(async (transaction) => {
      const attachment = await transaction.operationAttachment.create({
        data,
        omit: { storageKey: true, deletedAt: true },
      });
      await transaction.operationHistory.create({
        data: {
          operationId: data.operationId,
          userId: actorId,
          action: 'ATTACHMENT_ADDED',
          details: {
            attachmentId: attachment.id,
            fileName: attachment.fileName,
          },
        },
      });
      return attachment;
    });
  }

  /**
   * O registro de campo de um atendimento: as evidências e o aceite do cliente.
   *
   * Duas consultas na mesma transação porque são duas tabelas independentes — a
   * evidência aponta para a operação, o aceite aponta para ela por tipo e id. Lê-las
   * separadas deixaria a janela em que uma foto entra entre uma e outra, e a tela
   * mostraria um conjunto que nunca existiu.
   *
   * Só evidência `FINALIZED`: as que ainda estão subindo não têm arquivo no storage,
   * e assinar URL para elas devolveria endereço que responde 404.
   */
  fieldRecord(operationId: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const evidence = await tx.fieldEvidence.findMany({
        where: { operationId, organizationId, status: 'FINALIZED' },
        orderBy: [{ category: 'asc' }, { capturedAt: 'asc' }, { id: 'asc' }],
        include: {
          storageFile: true,
          capturedBy: { select: { id: true, displayName: true } },
        },
      });

      const acknowledgement = await tx.customerAcknowledgement.findFirst({
        where: {
          organizationId,
          executionType: 'OPERATION',
          executionId: operationId,
          /* Aceite invalidado não conta: o atendimento mudou depois dele, e
             mostrá-lo como válido diria que o cliente aceitou o que não viu. */
          invalidatedAt: null,
        },
        orderBy: { acknowledgedAt: 'desc' },
      });

      const signatureFile = acknowledgement?.signatureStorageFileId
        ? await tx.storageFile.findFirst({
            where: {
              id: acknowledgement.signatureStorageFileId,
              organizationId,
            },
          })
        : null;

      const capturedBy = acknowledgement
        ? await tx.user.findFirst({
            where: { id: acknowledgement.capturedByUserId },
            select: { id: true, displayName: true },
          })
        : null;

      return { evidence, acknowledgement, signatureFile, capturedBy };
    });
  }

  findAttachment(id: string, operationId: string) {
    return this.rls.run((transaction) =>
      transaction.operationAttachment.findFirst({
        where: { id, operationId, deletedAt: null },
      }),
    );
  }

  softDeleteAttachment(
    id: string,
    operationId: string,
    actorId: string,
  ): Promise<void> {
    return this.rls
      .run(async (transaction) => {
        await transaction.operationAttachment.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        await transaction.operationHistory.create({
          data: {
            operationId,
            userId: actorId,
            action: 'ATTACHMENT_REMOVED',
            details: { attachmentId: id },
          },
        });
      })
      .then(() => undefined);
  }

  softDelete(id: string, userId: string): Promise<void> {
    return this.rls
      .run(async (transaction) => {
        await transaction.operationHistory.create({
          data: { operationId: id, userId, action: 'DELETED' },
        });
        await transaction.operation.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
      })
      .then(() => undefined);
  }

  findBusinessUnit(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.businessUnit.findFirst({
        where: { id, organizationId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
  }

  findCustomer(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.customer.findFirst({
        where: { id, organizationId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
  }

  /** Os equipamentos destes ids que estão disponíveis nesta unidade. */
  findAssets(
    ids: readonly string[],
    organizationId: string,
    businessUnitId: string,
  ) {
    return this.rls.run((transaction) =>
      transaction.asset.findMany({
        where: {
          id: { in: [...ids] },
          organizationId,
          businessUnitId,
          deletedAt: null,
          status: { not: 'RETIRED' },
        },
        select: { id: true, customerId: true },
      }),
    );
  }

  /** O endereço, com o dono — quem valida precisa saber de quem ele é. */
  findCustomerAddress(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.customerAddress.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, customerId: true },
      }),
    );
  }

  findAsset(id: string, organizationId: string, businessUnitId: string) {
    return this.rls.run((transaction) =>
      transaction.asset.findFirst({
        where: {
          id,
          organizationId,
          businessUnitId,
          deletedAt: null,
          status: { not: 'RETIRED' },
        },
        select: { id: true, customerId: true },
      }),
    );
  }

  findAssignableUser(
    userId: string,
    organizationId: string,
    businessUnitId: string,
  ) {
    return this.rls.run((transaction) =>
      transaction.businessUnitMembership.findFirst({
        where: {
          userId,
          organizationId,
          businessUnitId,
          status: 'ACTIVE',
          deletedAt: null,
          user: { status: 'ACTIVE', deletedAt: null },
        },
        select: { userId: true },
      }),
    );
  }
}
