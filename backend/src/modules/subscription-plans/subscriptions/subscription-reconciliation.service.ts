/**
 * Põe o banco em dia com o relógio.
 *
 * ## O que este serviço não é
 *
 * Não é a autoridade sobre o estado. A autoridade é a função pura de projeção,
 * que qualquer leitura aplica: uma assinatura vencida já está vencida para
 * quem a lê, mesmo que este reconciliador esteja parado. Ele existe para que a
 * linha guardada reflita a verdade — auditoria, relatório e consulta direta
 * merecem ver o mesmo que o produto vê.
 *
 * ## Por isso ele pode atrasar
 *
 * Se o processo ficar três horas fora do ar, ao voltar ele calcula o estado
 * correto de cada assinatura a partir dos carimbos: ninguém ganha três horas
 * de acesso, ninguém perde. Rodar duas vezes seguidas não muda nada — a
 * segunda passagem não encontra o que reconciliar.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { project } from './subscription.projection';
import type { SubscriptionRow } from './subscription.repository';
import { SubscriptionStatus, isTerminal } from './subscription.types';

/** Quantas assinaturas por passagem. Mantém a transação curta. */
const LOTE = 200;

export interface ReconciliationSummary {
  readonly examined: number;
  readonly updated: number;
  readonly expired: number;
  readonly suspended: number;
  readonly canceled: number;
  readonly renewed: number;
  readonly planChangesApplied: number;
}

@Injectable()
export class SubscriptionReconciliationService {
  private readonly logger = new Logger(SubscriptionReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reconcilia tudo o que venceu até `at`.
   *
   * ## Por que este caminho declara contexto de plataforma
   *
   * Varrer prazos é trabalho da plataforma, e não de um inquilino: não existe
   * "a organização" desta passagem — existem todas. Sob RLS, o papel de
   * runtime sem contexto declarado enxerga zero linhas, e a primeira execução
   * desta suíte provou isso reconciliando nada.
   *
   * O contexto é declarado **por transação**, e a única tabela que este
   * serviço toca é a da própria assinatura. Nenhum dado de domínio — cliente,
   * ordem, documento — é lido ou escrito aqui.
   */
  async reconcile(at: Date = new Date()): Promise<ReconciliationSummary> {
    const resumo = {
      examined: 0,
      updated: 0,
      expired: 0,
      suspended: 0,
      canceled: 0,
      renewed: 0,
      planChangesApplied: 0,
    };

    let cursor: string | undefined;
    for (;;) {
      const lote = await this.comoPlataforma((tx) =>
        tx.organizationSubscription.findMany({
          where: {
            endedAt: null,
            ...(cursor ? { id: { gt: cursor } } : {}),
            OR: [
              { status: 'TRIALING', trialEndsAt: { lte: at } },
              { status: 'GRACE_PERIOD', graceEndsAt: { lte: at } },
              {
                status: { in: ['ACTIVE', 'TRIALING'] },
                currentPeriodEnd: { lte: at },
              },
              { pendingEffectiveAt: { lte: at } },
            ],
          },
          orderBy: { id: 'asc' },
          take: LOTE,
        }),
      );
      if (lote.length === 0) break;
      cursor = lote[lote.length - 1]!.id;

      for (const linha of lote) {
        resumo.examined += 1;
        if (await this.aplicar(linha, at, resumo)) {
          resumo.updated += 1;
        }
      }
      if (lote.length < LOTE) break;
    }

    if (resumo.updated > 0) {
      this.logger.log(
        JSON.stringify({ stage: 'subscriptions-reconciled', ...resumo }),
      );
    }
    return resumo;
  }

  /**
   * Uma transação que se declara da plataforma.
   *
   * `is_platform_admin` é o mesmo sinal que as políticas de RLS já preveem, e
   * vale só enquanto esta transação existir. O alcance real é o do código
   * acima, que só conhece uma tabela.
   */
  private comoPlataforma<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT set_config('app.is_platform_admin', 'true', true)`,
      );
      return work(tx);
    });
  }

  private async aplicar(
    linha: SubscriptionRow,
    at: Date,
    resumo: {
      expired: number;
      suspended: number;
      canceled: number;
      renewed: number;
      planChangesApplied: number;
    },
  ): Promise<boolean> {
    const projetado = project(
      {
        status: linha.status,
        billingInterval: linha.billingInterval,
        billingAnchorAt: linha.billingAnchorAt,
        currentPeriodStart: linha.currentPeriodStart,
        currentPeriodEnd: linha.currentPeriodEnd,
        trialEndsAt: linha.trialEndsAt,
        graceStartsAt: linha.graceStartsAt,
        graceEndsAt: linha.graceEndsAt,
        providerManaged: linha.providerSubscriptionId !== null,
        cancelAtPeriodEnd: linha.cancelAtPeriodEnd,
        pendingEffectiveAt: linha.pendingEffectiveAt,
      },
      at,
    );
    if (!projetado.changed) return false;

    const data: Prisma.OrganizationSubscriptionUpdateManyMutationInput = {
      status: projetado.status,
      currentPeriodStart: projetado.currentPeriodStart,
      currentPeriodEnd: projetado.currentPeriodEnd,
      graceStartsAt: projetado.graceStartsAt,
      graceEndsAt: projetado.graceEndsAt,
      version: { increment: 1 },
    };

    /** A mudança programada virou o plano vigente. Nada é apagado. */
    if (projetado.pendingApplied && linha.pendingPlanCode) {
      data.planCode = linha.pendingPlanCode;
      data.catalogVersion = linha.pendingCatalogVersion ?? undefined;
      data.entitlementsSnapshot =
        (linha.pendingEntitlementsSnapshot as Prisma.InputJsonValue) ??
        Prisma.JsonNull;
      if (linha.pendingBillingInterval) {
        data.billingInterval = linha.pendingBillingInterval;
      }
      data.pendingPlanCode = null;
      data.pendingBillingInterval = null;
      data.pendingCatalogVersion = null;
      data.pendingEntitlementsSnapshot = Prisma.DbNull;
      data.pendingEffectiveAt = null;
      resumo.planChangesApplied += 1;
    }

    /**
     * Estado terminal encerra a linha — e o histórico fica.
     *
     * `endedAt` tira a assinatura do índice de "corrente" sem apagar nada:
     * uma organização que volte a assinar ganha uma linha nova, e a anterior
     * continua contando o que aconteceu.
     */
    if (isTerminal(projetado.status)) {
      data.endedAt = at;
    }

    /**
     * Escrita com versão conferida no mesmo comando.
     *
     * Se um comando do cliente escreveu entre a leitura e aqui, esta passagem
     * simplesmente não altera nada — e a próxima passagem reconcilia o estado
     * já novo. É o que torna o reconciliador seguro para rodar concorrente
     * com o produto.
     */
    const { count } = await this.comoPlataforma((tx) =>
      tx.organizationSubscription.updateMany({
        where: { id: linha.id, version: linha.version },
        data,
      }),
    );
    if (count === 0) return false;

    if (projetado.status === SubscriptionStatus.EXPIRED) resumo.expired += 1;
    if (projetado.status === SubscriptionStatus.SUSPENDED)
      resumo.suspended += 1;
    if (projetado.status === SubscriptionStatus.CANCELED) resumo.canceled += 1;
    if (projetado.renewed) resumo.renewed += 1;
    return true;
  }
}
