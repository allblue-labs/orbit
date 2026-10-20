/**
 * Persistência da comissão.
 *
 * ## O que é lido e o que é gravado
 *
 * Lido: atendimentos concluídos com o técnico responsável, os auxiliares ativos
 * e a receita confirmada. Gravado: a política e os pagamentos. A comissão
 * pendente não existe como linha — ver o comentário do schema.
 *
 * ## Nada sai daqui sem passar pela RLS
 *
 * Toda leitura e escrita roda em `RlsTransaction`. Um `where` esquecido no
 * TypeScript não vaza a comissão de outra organização, porque o Postgres não
 * devolve a linha.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import type { CommissionLine } from './commission.calculator';

/** As colunas que o cálculo precisa, e só elas. */
const operationView = {
  id: true,
  code: true,
  title: true,
  kind: true,
  status: true,
  completedAt: true,
  responsibleFieldTechnicianId: true,
  customer: { select: { tradeName: true, legalName: true } },
  /* Só os auxiliares que continuam no atendimento: quem foi removido não
     trabalhou nele até o fim, e pagar comissão a ele seria pagar por uma
     atribuição desfeita. */
  auxiliaryTechnicians: {
    where: { removedAt: null },
    select: { userId: true },
  },
  /* A base do percentual: receita **confirmada**. Lançamento previsto é
     promessa, e comissão sobre promessa é adiantamento. */
  financialEntries: {
    where: { type: 'INCOME', status: 'CONFIRMED', deletedAt: null },
    select: { amount: true },
  },
} satisfies Prisma.OperationSelect;

const paymentView = {
  id: true,
  userId: true,
  amount: true,
  currency: true,
  method: true,
  notes: true,
  periodStart: true,
  periodEnd: true,
  paidAt: true,
  createdBy: { select: { id: true, displayName: true } },
  items: {
    select: {
      id: true,
      operationId: true,
      role: true,
      mode: true,
      rate: true,
      baseAmount: true,
      amount: true,
      operation: { select: { code: true, title: true, completedAt: true } },
    },
  },
} satisfies Prisma.CommissionPaymentSelect;

export interface CommissionWorkload {
  assignedOperations: number;
  operationsInProgress: number;
  executionsResponsible: number;
  executionsInProgress: number;
}

export interface PaidKey {
  operationId: string;
  userId: string;
  role: string;
}

@Injectable()
export class CommissionRepository {
  constructor(private readonly rls: RlsTransaction) {}

  findPolicy(organizationId: string) {
    return this.rls.run((tx) =>
      tx.commissionPolicy.findUnique({ where: { organizationId } }),
    );
  }

  upsertPolicy(
    organizationId: string,
    actorId: string,
    data: {
      period: string;
      mode: string;
      primaryValue: number;
      assistantValue: number;
      eligibleKinds: string[];
      requiresConfirmedRevenue: boolean;
      active: boolean;
    },
  ) {
    return this.rls.run(async (tx) => {
      const policy = await tx.commissionPolicy.upsert({
        where: { organizationId },
        create: {
          id: generateUuidV7(),
          organizationId,
          createdById: actorId,
          ...data,
        },
        update: data,
      });

      /* A política decide quanto cada técnico recebe: mudá-la sem rastro
         deixaria um fechamento diferente do anterior sem explicação. */
      await tx.auditLog.create({
        data: {
          organizationId,
          userId: actorId,
          action: 'commission.policy.updated',
          entityType: 'COMMISSION_POLICY',
          entityId: policy.id,
          after: data,
        },
      });

      return policy;
    });
  }

  /**
   * Atendimentos concluídos na janela.
   *
   * O recorte é por `completedAt`, que é quando a comissão passa a existir — e
   * não por `createdAt`, que é quando o atendimento foi aberto. Um atendimento
   * aberto em março e concluído em abril é comissão de abril.
   */
  findCompletedOperations(input: {
    organizationId: string;
    from: Date;
    to: Date;
    businessUnitId?: string;
    userId?: string;
  }) {
    return this.rls.run((tx) =>
      tx.operation.findMany({
        where: {
          organizationId: input.organizationId,
          deletedAt: null,
          status: 'COMPLETED',
          completedAt: { gte: input.from, lte: input.to },
          ...(input.businessUnitId
            ? { businessUnitId: input.businessUnitId }
            : {}),
          /* Recorte por pessoa: ela pode ser a responsável **ou** uma das
             auxiliares. Filtrar só pelo responsável esconderia metade do
             trabalho de um auxiliar. */
          ...(input.userId
            ? {
                OR: [
                  { responsibleFieldTechnicianId: input.userId },
                  {
                    auxiliaryTechnicians: {
                      some: { userId: input.userId, removedAt: null },
                    },
                  },
                ],
              }
            : {}),
        },
        select: operationView,
        orderBy: { completedAt: 'desc' },
      }),
    );
  }

  /** As comissões já pagas na janela, para marcar o que não está pendente. */
  findPaidItems(input: {
    organizationId: string;
    operationIds: readonly string[];
  }) {
    if (input.operationIds.length === 0) return Promise.resolve([]);
    return this.rls.run((tx) =>
      tx.commissionPaymentItem.findMany({
        where: {
          organizationId: input.organizationId,
          operationId: { in: [...input.operationIds] },
        },
        select: {
          operationId: true,
          userId: true,
          role: true,
          amount: true,
          paymentId: true,
          payment: { select: { paidAt: true } },
        },
      }),
    );
  }

  /**
   * Quando o atendimento foi concluído.
   *
   * É o que permite achar uma comissão sem saber a janela dela: quem cancela
   * aponta o atendimento, e a derivação faz o resto.
   */
  async findCompletionDate(
    organizationId: string,
    operationId: string,
  ): Promise<Date | null> {
    const row = await this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id: operationId, organizationId, deletedAt: null },
        select: { completedAt: true },
      }),
    );
    return row?.completedAt ?? null;
  }

  /** As cancelações em vigor das comissões consultadas. */
  findCancellations(input: {
    organizationId: string;
    operationIds: readonly string[];
  }) {
    if (input.operationIds.length === 0) return Promise.resolve([]);
    return this.rls.run((tx) =>
      tx.commissionCancellation.findMany({
        where: {
          organizationId: input.organizationId,
          operationId: { in: [...input.operationIds] },
          revokedAt: null,
        },
        select: {
          id: true,
          operationId: true,
          userId: true,
          role: true,
          reason: true,
          cancelledAt: true,
        },
      }),
    );
  }

  /**
   * Registra a decisão de não pagar.
   *
   * O índice único parcial recusa uma segunda cancelação em vigor para a mesma
   * comissão — dois cliques terminam com uma decisão e um erro.
   */
  createCancellation(input: {
    organizationId: string;
    operationId: string;
    userId: string;
    role: string;
    reason?: string;
    actorId: string;
  }) {
    return this.rls.run(async (tx) => {
      const id = generateUuidV7();
      const row = await tx.commissionCancellation.create({
        data: {
          id,
          organizationId: input.organizationId,
          operationId: input.operationId,
          userId: input.userId,
          role: input.role,
          reason: input.reason,
          cancelledById: input.actorId,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.actorId,
          action: 'commission.cancelled',
          entityType: 'COMMISSION',
          entityId: input.operationId,
          after: {
            userId: input.userId,
            role: input.role,
            reason: input.reason ?? null,
          },
        },
      });

      return row;
    });
  }

  /**
   * Desfaz a decisão, sem apagá-la.
   *
   * Devolve quantas linhas mudaram: zero significa que não havia cancelação em
   * vigor, e quem pediu precisa saber a diferença entre "desfeito" e "não havia
   * o que desfazer".
   */
  revokeCancellation(input: {
    organizationId: string;
    operationId: string;
    userId: string;
    role: string;
    actorId: string;
  }) {
    return this.rls.run(async (tx) => {
      const { count } = await tx.commissionCancellation.updateMany({
        where: {
          organizationId: input.organizationId,
          operationId: input.operationId,
          userId: input.userId,
          role: input.role,
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokedById: input.actorId },
      });

      if (count > 0) {
        await tx.auditLog.create({
          data: {
            organizationId: input.organizationId,
            userId: input.actorId,
            action: 'commission.cancellation.revoked',
            entityType: 'COMMISSION',
            entityId: input.operationId,
            after: { userId: input.userId, role: input.role },
          },
        });
      }

      return count;
    });
  }

  listPayments(input: {
    organizationId: string;
    userId?: string;
    from?: Date;
    to?: Date;
    limit: number;
  }) {
    return this.rls.run((tx) =>
      tx.commissionPayment.findMany({
        where: {
          organizationId: input.organizationId,
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.from || input.to
            ? {
                paidAt: {
                  ...(input.from ? { gte: input.from } : {}),
                  ...(input.to ? { lte: input.to } : {}),
                },
              }
            : {}),
        },
        select: paymentView,
        orderBy: { paidAt: 'desc' },
        take: input.limit,
      }),
    );
  }

  /**
   * Grava o pagamento e os itens numa transação.
   *
   * O valor vem calculado pelo servidor, e o índice único de
   * `commission_payment_items` recusa a segunda tentativa de pagar a mesma
   * comissão. Dois cliques simultâneos em "pagar todas" terminam com um
   * pagamento e um erro — nunca com dois pagamentos.
   */
  createPayment(input: {
    organizationId: string;
    businessUnitId?: string | null;
    userId: string;
    actorId: string;
    amount: number;
    method?: string;
    notes?: string;
    periodStart?: Date;
    periodEnd?: Date;
    lines: readonly CommissionLine[];
  }) {
    return this.rls.run(async (tx) => {
      const paymentId = generateUuidV7();

      const payment = await tx.commissionPayment.create({
        data: {
          id: paymentId,
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId ?? null,
          userId: input.userId,
          amount: new Prisma.Decimal(input.amount),
          method: input.method,
          notes: input.notes,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          createdById: input.actorId,
          items: {
            create: input.lines.map((line) => ({
              id: generateUuidV7(),
              organizationId: input.organizationId,
              operationId: line.operationId,
              userId: line.userId,
              role: line.role,
              mode: line.mode,
              rate: new Prisma.Decimal(line.rate),
              baseAmount:
                line.baseAmount === null
                  ? null
                  : new Prisma.Decimal(line.baseAmount),
              amount: new Prisma.Decimal(line.amount),
            })),
          },
        },
        select: paymentView,
      });

      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId ?? null,
          userId: input.actorId,
          action: 'commission.payment.created',
          entityType: 'COMMISSION_PAYMENT',
          entityId: paymentId,
          after: {
            userId: input.userId,
            amount: input.amount,
            operations: input.lines.length,
          },
        },
      });

      return payment;
    });
  }

  /**
   * A carga de trabalho de cada técnico, numa consulta por eixo.
   *
   * A tela da Equipe mostra quatro números por pessoa. Buscá-los como a tela
   * fazia antes — uma consulta com `limit: 1` por número, lendo `meta.total` —
   * custaria quatro requisições por linha: oitenta numa equipe de vinte. Aqui são
   * quatro agrupamentos para a lista inteira.
   *
   * "Atribuído" é a mesma definição da listagem de atendimentos: responsável de
   * campo, auxiliar ativo **ou** usuário atribuído. Três formas de estar no
   * atendimento, e contar só a primeira esconderia o trabalho do auxiliar.
   */
  async findWorkload(organizationId: string, userIds: readonly string[]) {
    if (userIds.length === 0) {
      return new Map<string, CommissionWorkload>();
    }
    const ids = [...userIds];

    return this.rls.run(async (tx) => {
      const carga = new Map<string, CommissionWorkload>(
        ids.map((userId) => [
          userId,
          {
            assignedOperations: 0,
            operationsInProgress: 0,
            executionsResponsible: 0,
            executionsInProgress: 0,
          },
        ]),
      );

      const somar = (
        userId: string,
        campo: keyof CommissionWorkload,
        quanto: number,
      ) => {
        const linha = carga.get(userId);
        if (linha) linha[campo] += quanto;
      };

      const atribuido = (userId: string) => ({
        organizationId,
        deletedAt: null,
        OR: [
          { responsibleFieldTechnicianId: userId },
          { auxiliaryTechnicians: { some: { userId, removedAt: null } } },
          { users: { some: { userId } } },
        ],
      });

      /* Sequencial de propósito: consultas concorrentes na mesma transação
         interativa do Prisma disputam a única conexão dela. */
      for (const userId of ids) {
        somar(
          userId,
          'assignedOperations',
          await tx.operation.count({ where: atribuido(userId) }),
        );
        somar(
          userId,
          'operationsInProgress',
          await tx.operation.count({
            where: { ...atribuido(userId), status: 'IN_PROGRESS' },
          }),
        );
      }

      const execucoes = await tx.artifactExecution.groupBy({
        by: ['responsibleUserId', 'status'],
        where: {
          organizationId,
          deletedAt: null,
          responsibleUserId: { in: ids },
        },
        _count: { _all: true },
      });

      for (const linha of execucoes) {
        if (!linha.responsibleUserId) continue;
        somar(
          linha.responsibleUserId,
          'executionsResponsible',
          linha._count._all,
        );
        if (linha.status === 'IN_PROGRESS') {
          somar(
            linha.responsibleUserId,
            'executionsInProgress',
            linha._count._all,
          );
        }
      }

      return carga;
    });
  }

  /**
   * Quem é técnico de campo na organização.
   *
   * A definição é a do `ProfessionalProfile`, a mesma que o seletor de técnicos
   * do resto do sistema usa: perfil ativo com `fieldTechnicianEnabled`. Inventar
   * outro critério aqui — por papel de acesso, por exemplo — faria a tabela de
   * comissões listar gente diferente do seletor de atribuição.
   */
  async findFieldTechnicianIds(
    organizationId: string,
    userId?: string,
  ): Promise<string[]> {
    const rows = await this.rls.run((tx) =>
      tx.professionalProfile.findMany({
        where: {
          organizationId,
          active: true,
          fieldTechnicianEnabled: true,
          ...(userId ? { userId } : {}),
        },
        select: { userId: true },
      }),
    );
    return rows.map((row) => row.userId);
  }

  /** Nome e situação de quem aparece na lista de comissões. */
  findTechnicians(organizationId: string, userIds: readonly string[]) {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.rls.run((tx) =>
      tx.organizationMembership.findMany({
        where: {
          organizationId,
          userId: { in: [...userIds] },
          deletedAt: null,
        },
        select: {
          userId: true,
          status: true,
          role: { select: { name: true } },
          user: { select: { displayName: true, email: true } },
        },
      }),
    );
  }
}
