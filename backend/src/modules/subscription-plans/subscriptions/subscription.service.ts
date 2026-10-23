/**
 * Os comandos do ciclo comercial.
 *
 * A assinatura é a autoridade sobre o que a organização contratou. O provedor
 * de pagamento — quando existir, na PR-PL-03 — traduzirá os eventos dele para
 * estes comandos; ele não é a autoridade, é uma fonte de fatos financeiros.
 *
 * ## Subir vale agora, descer vale depois
 *
 * Subir de plano entrega o que foi comprado imediatamente. Descer só vale no
 * próximo período: tirar capacidade e teto no meio de uma operação em campo
 * quebraria o trabalho de quem está no telhado com o aplicativo aberto, e por
 * um motivo administrativo.
 *
 * ## Nada aqui apaga nada
 *
 * Suspender, cancelar, expirar e rebaixar mudam **acesso**, nunca dados. Uma
 * organização suspensa que volte encontra os seus clientes, ordens e
 * documentos exatamente onde estavam.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictException } from '../../../exceptions';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import {
  BILLING_INTERVAL_MONTHS,
  BillingInterval,
  CATALOG_VERSION,
  type PlanCode,
} from '../catalog/plan-catalog.types';
import { planDefinition } from '../catalog/plan-registry';
import { anchoredPeriod } from '../entitlements/anchored-period';
import { snapshotOf } from './subscription.snapshot';
import {
  PlanChangeNotAllowedException,
  SubscriptionInvalidTransitionException,
  SubscriptionNotFoundException,
} from './subscription.errors';
import { project } from './subscription.projection';
import {
  SubscriptionRepository,
  type SubscriptionRow,
} from './subscription.repository';
import {
  GRACE_PERIOD_DAYS,
  SubscriptionStatus,
  allowsPlanChange,
  allowsTransition,
  isTerminal,
} from './subscription.types';

const DIA_MS = 24 * 60 * 60_000;

export interface CreateSubscriptionInput {
  organizationId: string;
  planCode: PlanCode;
  billingInterval: BillingInterval;
  /** Quando o acesso começa. O aniversário sai daqui. */
  startsAt?: Date;
  /**
   * A única autoridade possível na criação pública.
   *
   * Uma assinatura sem avaliação nasce aguardando pagamento. `ACTIVE` não
   * é uma opção deste comando: somente um fato financeiro confirmado pode
   * conceder acesso pago.
   */
  access:
    | { kind: 'TRIAL'; startsAt: Date; endsAt: Date }
    | { kind: 'PAYMENT_REQUIRED' };
}

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(private readonly repository: SubscriptionRepository) {}

  /* ---------------------------------------------------------------- */
  /* Leitura                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * A assinatura corrente, já reconciliada em memória.
   *
   * O estado devolvido é o de **agora**, mesmo que o reconciliador ainda não
   * tenha passado. É esta a garantia que impede um worker atrasado de dar
   * tempo extra a quem venceu.
   */
  async currentOrNull(
    organizationId: string,
    at: Date = new Date(),
  ): Promise<
    (SubscriptionRow & { effectiveStatus: SubscriptionStatus }) | null
  > {
    const linha = await this.repository.findCurrent(organizationId);
    if (!linha) return null;
    const projetado = project(this.estado(linha), at);
    return {
      ...linha,
      currentPeriodStart: projetado.currentPeriodStart,
      currentPeriodEnd: projetado.currentPeriodEnd,
      graceStartsAt: projetado.graceStartsAt,
      graceEndsAt: projetado.graceEndsAt,
      effectiveStatus: projetado.status,
    };
  }

  async requireCurrent(organizationId: string, at: Date = new Date()) {
    const assinatura = await this.currentOrNull(organizationId, at);
    if (!assinatura) throw new SubscriptionNotFoundException(organizationId);
    return assinatura;
  }

  /* ---------------------------------------------------------------- */
  /* Comandos                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Cria a assinatura corrente.
   *
   * O retrato dos direitos é tirado agora e guardado: mudar o catálogo amanhã
   * não altera o que esta organização contratou hoje.
   */
  async create(
    input: CreateSubscriptionInput,
    transaction?: PrismaTransactionClient,
  ): Promise<SubscriptionRow> {
    const existente = await this.repository.findCurrent(
      input.organizationId,
      transaction,
    );
    if (existente) {
      throw new ConflictException(
        'Organization already has a current subscription',
        'CONFLICT',
      );
    }
    const plano = planDefinition(input.planCode);
    const inicio = input.startsAt ?? new Date();
    const periodo = anchoredPeriod(
      inicio,
      BILLING_INTERVAL_MONTHS[input.billingInterval] ?? 1,
      inicio,
    );
    return this.repository.create(
      {
        organizationId: input.organizationId,
        planCode: plano.code,
        catalogVersion: CATALOG_VERSION,
        entitlementsSnapshot: snapshotOf(plano) as unknown as Prisma.JsonValue,
        billingInterval: input.billingInterval,
        status:
          input.access.kind === 'TRIAL'
            ? SubscriptionStatus.TRIALING
            : SubscriptionStatus.PENDING_PAYMENT,
        billingAnchorAt: inicio,
        currentPeriodStart: periodo.start,
        currentPeriodEnd: periodo.end,
        trialStartsAt:
          input.access.kind === 'TRIAL' ? input.access.startsAt : null,
        trialEndsAt: input.access.kind === 'TRIAL' ? input.access.endsAt : null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        graceStartsAt: null,
        graceEndsAt: null,
        pendingPlanCode: null,
        pendingBillingInterval: null,
        pendingCatalogVersion: null,
        pendingEntitlementsSnapshot: null,
        pendingEffectiveAt: null,
        startedAt: inicio,
        endedAt: null,
      },
      transaction,
    );
  }

  /**
   * Agenda o encerramento para o fim do período já contratado.
   *
   * Vale igual para mensal, semestral e anual: o cliente pagou por um tempo de
   * acesso e recebe esse tempo. Não há devolução nem cálculo proporcional aqui
   * — isso é decisão financeira, e não existe provedor financeiro nesta etapa.
   */
  async cancelAtPeriodEnd(organizationId: string, expectedVersion: number) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      if (isTerminal(atual.effectiveStatus)) {
        throw new SubscriptionInvalidTransitionException(
          atual.effectiveStatus,
          SubscriptionStatus.CANCELED,
        );
      }
      return { cancelAtPeriodEnd: true, canceledAt: new Date() };
    });
  }

  /** Desfaz o encerramento agendado, enquanto o período ainda corre. */
  async keepSubscription(organizationId: string, expectedVersion: number) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      if (!atual.cancelAtPeriodEnd) {
        throw new PlanChangeNotAllowedException('no scheduled cancellation');
      }
      if (isTerminal(atual.effectiveStatus)) {
        throw new SubscriptionInvalidTransitionException(
          atual.effectiveStatus,
          SubscriptionStatus.ACTIVE,
        );
      }
      return { cancelAtPeriodEnd: false, canceledAt: null };
    });
  }

  /**
   * Troca de plano.
   *
   * Subir vale na hora; descer entra na fila do próximo período. Quem decide
   * qual é qual é o preço de tabela mensal do catálogo — é a única ordenação
   * comercial que existe entre os planos, e ela não depende de nome.
   */
  async changePlan(
    organizationId: string,
    expectedVersion: number,
    planCode: PlanCode,
    billingInterval?: BillingInterval,
  ) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      if (!allowsPlanChange(atual.effectiveStatus)) {
        throw new PlanChangeNotAllowedException(
          `status ${atual.effectiveStatus}`,
        );
      }
      const destino = planDefinition(planCode);
      const origem = planDefinition(atual.planCode);
      const intervalo = billingInterval ?? atual.billingInterval;

      const mesmoPlano = destino.code === origem.code;
      const mesmoIntervalo = intervalo === atual.billingInterval;
      if (mesmoPlano && mesmoIntervalo) {
        throw new PlanChangeNotAllowedException('no change requested');
      }

      const subida =
        destino.prices[BillingInterval.MONTHLY]!.amountMinor >
        origem.prices[BillingInterval.MONTHLY]!.amountMinor;

      /**
       * Durante a avaliação, **nenhuma** troca é imediata.
       *
       * Os trinta dias gratuitos existem para o Essencial e só concedem os
       * limites dele — é essa a condição com que foram oferecidos. Como a
       * subida aplicava o plano de destino na hora e a avaliação seguia
       * correndo, dava para entrar no Essencial grátis, trocar para o
       * Profissional no mesmo minuto e usar os limites maiores sem pagar nada
       * até o trigésimo dia.
       *
       * Programar para o fim da avaliação resolve sem punir ninguém: quem
       * escolheu outro plano o recebe quando o período gratuito acaba, que é
       * exatamente quando a cobrança começa. Recusar a troca, ou exigir
       * pagamento na hora e derrubar o acesso, trataria uma intenção legítima
       * como abuso.
       */
      if (atual.effectiveStatus === SubscriptionStatus.TRIALING) {
        return {
          pendingPlanCode: destino.code,
          pendingBillingInterval: intervalo,
          pendingCatalogVersion: CATALOG_VERSION,
          pendingEntitlementsSnapshot: snapshotOf(
            destino,
          ) as unknown as Prisma.InputJsonValue,
          /* O fim da avaliação, não o do período de cobrança: é ele que marca
             o instante em que o gratuito acaba. */
          pendingEffectiveAt: atual.trialEndsAt ?? atual.currentPeriodEnd,
        };
      }

      if (subida) {
        /** Imediato: o cliente comprou mais e recebe agora. */
        const periodo = anchoredPeriod(
          atual.billingAnchorAt,
          BILLING_INTERVAL_MONTHS[intervalo] ?? 1,
          new Date(),
        );
        return {
          planCode: destino.code,
          catalogVersion: CATALOG_VERSION,
          entitlementsSnapshot: snapshotOf(
            destino,
          ) as unknown as Prisma.InputJsonValue,
          billingInterval: intervalo,
          currentPeriodStart: periodo.start,
          currentPeriodEnd: periodo.end,
          pendingPlanCode: null,
          pendingBillingInterval: null,
          pendingCatalogVersion: null,
          pendingEntitlementsSnapshot: Prisma.DbNull,
          pendingEffectiveAt: null,
        };
      }

      /**
       * Programado: nada muda até o período virar.
       *
       * Rebaixar não desliga ninguém nem apaga recurso. Quando a mudança valer,
       * o que existe continua existindo — o que fica bloqueado é criar mais.
       */
      return {
        pendingPlanCode: destino.code,
        pendingBillingInterval: intervalo,
        pendingCatalogVersion: CATALOG_VERSION,
        pendingEntitlementsSnapshot: snapshotOf(
          destino,
        ) as unknown as Prisma.InputJsonValue,
        pendingEffectiveAt: atual.currentPeriodEnd,
      };
    });
  }

  /** Cancela uma troca ainda não efetivada. */
  async cancelScheduledChange(organizationId: string, expectedVersion: number) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      if (!atual.pendingPlanCode) {
        throw new PlanChangeNotAllowedException('no scheduled change');
      }
      return {
        pendingPlanCode: null,
        pendingBillingInterval: null,
        pendingCatalogVersion: null,
        pendingEntitlementsSnapshot: Prisma.DbNull,
        pendingEffectiveAt: null,
      };
    });
  }

  /**
   * Espelha uma troca futura que o provedor já aceitou.
   *
   * É separado de `changePlan`: aqui o instante efetivo vem do período
   * canônico do provedor, não de um cálculo local sujeito a drift.
   */
  async scheduleProviderPlanChange(
    organizationId: string,
    expectedVersion: number,
    planCode: PlanCode,
    billingInterval: BillingInterval,
    effectiveAt: Date,
  ) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      if (!allowsPlanChange(atual.effectiveStatus)) {
        throw new PlanChangeNotAllowedException(
          `status ${atual.effectiveStatus}`,
        );
      }
      if (effectiveAt <= new Date()) {
        throw new ConflictException(
          'Provider plan change effective date is invalid',
          'INVALID_PROVIDER_PERIOD',
        );
      }
      const destino = planDefinition(planCode);
      return {
        pendingPlanCode: destino.code,
        pendingBillingInterval: billingInterval,
        pendingCatalogVersion: CATALOG_VERSION,
        pendingEntitlementsSnapshot: snapshotOf(
          destino,
        ) as unknown as Prisma.InputJsonValue,
        pendingEffectiveAt: effectiveAt,
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Fatos financeiros — a PR-PL-03 os trará do provedor               */
  /* ---------------------------------------------------------------- */

  /** A cobrança falhou. O acesso continua; o relógio da carência começa. */
  async reportPaymentFailed(organizationId: string, expectedVersion: number) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      this.assertTransicao(atual.effectiveStatus, SubscriptionStatus.PAST_DUE);
      const agora = new Date();
      return {
        status: SubscriptionStatus.GRACE_PERIOD,
        graceStartsAt: agora,
        graceEndsAt: new Date(agora.getTime() + GRACE_PERIOD_DAYS * DIA_MS),
      };
    });
  }

  /** A cobrança entrou. Volta a valer, e a carência é esquecida. */
  async reportPaymentSucceeded(
    organizationId: string,
    expectedVersion: number,
    period: { start: Date; end: Date },
  ) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      if (
        atual.effectiveStatus !== SubscriptionStatus.ACTIVE &&
        !allowsTransition(atual.effectiveStatus, SubscriptionStatus.ACTIVE)
      ) {
        throw new SubscriptionInvalidTransitionException(
          atual.effectiveStatus,
          SubscriptionStatus.ACTIVE,
        );
      }
      if (period.start >= period.end) {
        throw new ConflictException(
          'Provider billing period is invalid',
          'INVALID_PROVIDER_PERIOD',
        );
      }
      return {
        status: SubscriptionStatus.ACTIVE,
        graceStartsAt: null,
        graceEndsAt: null,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
      };
    });
  }

  /**
   * Aplica preço e período que já foram confirmados pelo provedor.
   *
   * Esta é a única escrita que pode conceder o plano novo de uma assinatura
   * vinculada. O comando HTTP não "acha" que o upgrade deu certo: ele passa
   * por aqui somente com o retrato canônico retornado pelo provedor.
   */
  async applyProviderPlan(
    organizationId: string,
    expectedVersion: number,
    input: {
      planCode: PlanCode;
      billingInterval: BillingInterval;
      period: { start: Date; end: Date };
      activate: boolean;
      cancelAtPeriodEnd: boolean;
    },
  ) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      if (input.period.start >= input.period.end) {
        throw new ConflictException(
          'Provider billing period is invalid',
          'INVALID_PROVIDER_PERIOD',
        );
      }
      if (
        input.activate &&
        atual.effectiveStatus !== SubscriptionStatus.ACTIVE &&
        !allowsTransition(atual.effectiveStatus, SubscriptionStatus.ACTIVE)
      ) {
        throw new SubscriptionInvalidTransitionException(
          atual.effectiveStatus,
          SubscriptionStatus.ACTIVE,
        );
      }

      const destino = planDefinition(input.planCode);
      const contractedChanged =
        atual.planCode !== destino.code ||
        atual.billingInterval !== input.billingInterval;
      return {
        ...(contractedChanged
          ? {
              planCode: destino.code,
              catalogVersion: CATALOG_VERSION,
              entitlementsSnapshot: snapshotOf(
                destino,
              ) as unknown as Prisma.InputJsonValue,
              billingInterval: input.billingInterval,
              billingAnchorAt: input.period.start,
            }
          : {}),
        ...(input.activate
          ? {
              status: SubscriptionStatus.ACTIVE,
              // Preserva o início histórico e encerra os dias gratuitos na conversão.
              ...(atual.status === SubscriptionStatus.TRIALING
                ? { trialEndsAt: input.period.start }
                : {}),
            }
          : {}),
        currentPeriodStart: input.period.start,
        currentPeriodEnd: input.period.end,
        graceStartsAt: null,
        graceEndsAt: null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        canceledAt: input.cancelAtPeriodEnd
          ? (atual.canceledAt ?? new Date())
          : null,
        pendingPlanCode: null,
        pendingBillingInterval: null,
        pendingCatalogVersion: null,
        pendingEntitlementsSnapshot: Prisma.DbNull,
        pendingEffectiveAt: null,
      };
    });
  }

  /** Reflete somente o cancelamento que o provedor confirmou. */
  async applyProviderCancellation(
    organizationId: string,
    expectedVersion: number,
    cancelAtPeriodEnd: boolean,
  ) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      if (isTerminal(atual.effectiveStatus)) {
        throw new SubscriptionInvalidTransitionException(
          atual.effectiveStatus,
          SubscriptionStatus.CANCELED,
        );
      }
      return {
        cancelAtPeriodEnd,
        canceledAt: cancelAtPeriodEnd ? (atual.canceledAt ?? new Date()) : null,
      };
    });
  }

  /** O provedor encerrou a assinatura. O acesso termina sem renovação local. */
  async reportProviderEnded(organizationId: string, expectedVersion: number) {
    return this.comando(organizationId, expectedVersion, (atual) => {
      this.assertTransicao(atual.effectiveStatus, SubscriptionStatus.CANCELED);
      const agora = new Date();
      return {
        status: SubscriptionStatus.CANCELED,
        cancelAtPeriodEnd: false,
        canceledAt: atual.canceledAt ?? agora,
        endedAt: agora,
        graceStartsAt: null,
        graceEndsAt: null,
        pendingPlanCode: null,
        pendingBillingInterval: null,
        pendingCatalogVersion: null,
        pendingEntitlementsSnapshot: Prisma.DbNull,
        pendingEffectiveAt: null,
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Vínculo com o provedor                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Registra o retrato do provedor — diagnóstico, não decisão.
   *
   * `providerStatus` existe para quem investiga um caso; nenhuma regra o
   * consulta. O que decide acesso continua sendo `status`, que é do Orbit. Sem
   * conferência de versão de propósito: isto não muda direito nenhum, e
   * recusar um retrato por corrida só deixaria o diagnóstico velho.
   */
  async syncProviderSnapshot(
    id: string,
    snapshot: {
      providerStatus: string;
      providerPriceId: string | null;
      providerLastEventId: string | null;
      cancelAtPeriodEnd: boolean;
    },
  ): Promise<void> {
    await this.repository.updateProviderSnapshot(id, {
      providerStatus: snapshot.providerStatus,
      providerPriceId: snapshot.providerPriceId,
      providerLastEventId: snapshot.providerLastEventId,
      providerUpdatedAt: new Date(),
      cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    });
  }

  /** Liga a assinatura do Orbit à do provedor. Uma vez, e só uma. */
  async linkProvider(
    id: string,
    link: {
      provider: string;
      providerSubscriptionId: string;
      providerCustomerId: string;
      providerPriceId: string | null;
      providerStatus: string;
      expectedVersion?: number;
    },
  ): Promise<void> {
    const linked = await this.repository.linkProvider(id, link);
    if (!linked) {
      throw new ConflictException(
        'Subscription is already linked to another provider object',
        'CONFLICT',
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* Internos                                                          */
  /* ---------------------------------------------------------------- */

  private assertTransicao(from: string, to: SubscriptionStatus): void {
    if (!allowsTransition(from, to)) {
      throw new SubscriptionInvalidTransitionException(from, to);
    }
  }

  /**
   * Um comando, com versão conferida no mesmo comando que escreve.
   *
   * Cancelar e trocar de plano ao mesmo tempo não pode produzir um estado que
   * nenhum dos dois pediu: quem chega segundo encontra a versão mudada e é
   * recusado com `STALE_VERSION`, o mesmo código que o resto do produto usa.
   */
  private async comando(
    organizationId: string,
    expectedVersion: number,
    decidir: (
      atual: SubscriptionRow & { effectiveStatus: SubscriptionStatus },
    ) => Prisma.OrganizationSubscriptionUpdateInput,
  ): Promise<SubscriptionRow> {
    const atual = await this.requireCurrent(organizationId);
    const atualizada = await this.repository.updateIfVersion(
      atual.id,
      expectedVersion,
      decidir(atual),
    );
    if (!atualizada) {
      throw new ConflictException(
        'Subscription version is stale',
        'STALE_VERSION',
      );
    }
    return atualizada;
  }

  private estado(linha: SubscriptionRow) {
    return {
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
    };
  }
}
