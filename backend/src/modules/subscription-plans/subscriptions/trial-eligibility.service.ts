/**
 * Quem pode receber a avaliação gratuita, e quem já recebeu a sua.
 *
 * ## A identidade forte é o documento
 *
 * Uma conta nova não é uma empresa nova. Uma organização nova também não. O
 * que identifica quem está contratando é o CPF ou o CNPJ, e é ele — em forma
 * de impressão HMAC — que o antifraude conhece. Trocar de e-mail, de endereço
 * ou de razão social não devolve um segundo período de teste.
 *
 * ## Endereço não bloqueia ninguém
 *
 * Coworking, shopping, condomínio empresarial e grupo econômico compartilham
 * endereço legitimamente todos os dias. Bloquear por endereço recusaria
 * empresas de verdade para atrapalhar uma fraude que troca de endereço em
 * cinco minutos. O endereço é **registrado** como sinal, e não decide nada
 * sozinho.
 *
 * ## A recusa não explica
 *
 * "Este CNPJ já usou" transformaria a resposta pública num verificador de
 * quem é cliente do Orbit. A recusa é sempre a mesma frase; o motivo fica no
 * log, que tem outra plateia.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { Prisma } from '@prisma/client';
import { type PlanCode as PlanCodeType } from '../catalog/plan-catalog.types';
import { snapshotOf } from './subscription.snapshot';
import { CommercialPlanService } from '../catalog/commercial-plan.service';
import { ConflictException } from '../../../exceptions';
import { TrialNotEligibleException } from './subscription.errors';
import { SubscriptionRepository } from './subscription.repository';
import { TrialFingerprintService } from './trial-fingerprint';
import { TrialRiskDecision } from './subscription.types';

const DIA_MS = 24 * 60 * 60_000;

/** Só o plano de entrada tem avaliação. Os demais se contratam direto. */

export interface TrialEvaluation {
  readonly eligible: boolean;
  readonly trialDays: number;
  /** Motivo interno. Nunca sai em resposta pública. */
  readonly internalReason: string | null;
}

export interface GrantTrialInput {
  organizationId: string;
  planCode: PlanCodeType;
  legalDocument: string;
  /** Sinais secundários. Registrados, nunca decisivos nesta versão. */
  signals?: Record<string, unknown>;
  at?: Date;
}

export interface GrantedTrial {
  readonly grantId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

@Injectable()
export class TrialEligibilityService {
  private readonly logger = new Logger(TrialEligibilityService.name);

  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly fingerprints: TrialFingerprintService,
    private readonly plans: CommercialPlanService,
  ) {}

  /** O plano oferece avaliação? Pergunta de catálogo, sem tocar no banco. */
  async offersTrial(
    planCode: string,
    organizationId: string,
  ): Promise<boolean> {
    const plan = await this.plans.selectable(planCode, organizationId);
    return plan.trialDays > 0;
  }

  /**
   * Avalia sem conceder.
   *
   * Serve à tela que precisa saber se deve mostrar o botão. A resposta é
   * booleana de propósito — quem chama não recebe motivo para repassar.
   */
  async evaluate(
    planCode: string,
    legalDocument: string,
  ): Promise<TrialEvaluation> {
    const plan = await this.plans.find(planCode);
    if (!plan?.isActive || !plan.trialDays || plan.tenantId !== null) {
      return {
        eligible: false,
        trialDays: 0,
        internalReason: 'plan does not offer trial',
      };
    }
    const impressao = this.fingerprints.fingerprint(legalDocument);
    const consumida = await this.repository.fingerprintConsumed(impressao);
    return {
      eligible: !consumida,
      trialDays: plan.trialDays,
      internalReason: consumida ? 'fingerprint already consumed' : null,
    };
  }

  async canStartPendingTrial(organizationId: string): Promise<boolean> {
    return (await this.pendingTrialBlock(organizationId)) === null;
  }

  async pendingTrialBlock(organizationId: string) {
    const candidate = await this.repository.trialCandidate(organizationId);
    if (!candidate.eligible) return 'CANDIDATE_NOT_ELIGIBLE' as const;
    if (!candidate.document) return 'DOCUMENT_UNAVAILABLE' as const;
    return (await this.hasConsumedTrial(candidate.document))
      ? ('TRIAL_ALREADY_USED' as const)
      : null;
  }

  async startPendingTrial(
    organizationId: string,
    expectedVersion: number,
    billingInterval: string,
    planCode: string,
    local?: { tx: PrismaTransactionClient; subscriptionId: string },
  ) {
    const plan = await this.plans.selectable(
      planCode,
      organizationId,
      ...(local ? ([local.tx] as const) : []),
    );
    if (!plan.trialDays)
      throw new TrialNotEligibleException('plan does not offer trial');
    const candidate = await this.repository.trialCandidate(organizationId);
    if (!candidate.eligible || !candidate.document)
      throw new TrialNotEligibleException('trial unavailable');
    const startsAt = new Date();
    try {
      return await this.repository.startPendingTrial(
        {
          organizationId,
          expectedVersion,
          billingInterval,
          planCode,
          startsAt,
          endsAt: new Date(startsAt.getTime() + plan.trialDays * DIA_MS),
          fingerprint: this.fingerprints.fingerprint(candidate.document),
          snapshot: snapshotOf(plan) as unknown as Prisma.InputJsonValue,
          catalogVersion: plan.version,
        },
        ...(local ? ([local] as const) : []),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'TRIAL_NOT_AVAILABLE')
        throw new TrialNotEligibleException('trial unavailable');
      if (
        error instanceof Error &&
        error.message === 'TRIAL_SUBSCRIPTION_CHANGED'
      )
        throw new ConflictException(
          'Subscription changed; reload before trying again',
          'CONFLICT',
        );
      throw error;
    }
  }

  async hasConsumedTrial(legalDocument: string): Promise<boolean> {
    return this.repository.fingerprintConsumed(
      this.fingerprints.fingerprint(legalDocument),
    );
  }

  /**
   * Concede a avaliação, ou recusa.
   *
   * A decisão final é do índice único global, e não da consulta acima: entre
   * avaliar e gravar cabe outra requisição, e duas organizações tentando ao
   * mesmo tempo com o mesmo documento têm de resultar em **uma** concessão.
   * A verificação prévia existe para dar a resposta barata no caso comum.
   */
  async grantTrial(
    input: GrantTrialInput,
    transaction?: PrismaTransactionClient,
  ): Promise<GrantedTrial> {
    const plan = await this.plans.require(input.planCode, transaction);
    if (
      !plan.trialDays ||
      (plan.tenantId !== null && plan.tenantId !== input.organizationId)
    ) {
      throw new TrialNotEligibleException(
        `plan ${input.planCode} does not offer trial`,
      );
    }
    const impressao = this.fingerprints.fingerprint(input.legalDocument);
    const inicio = input.at ?? new Date();
    const fim = new Date(inicio.getTime() + plan.trialDays * DIA_MS);

    /**
     * Por padrão, transação própria, com a organização declarada.
     *
     * Própria porque a recusa vem de uma violação de unicidade, e um erro do
     * Postgres aborta a transação inteira em que acontece: tentar aqui dentro
     * da transação de outra escrita faria essa outra escrita falhar em
     * seguida, com uma mensagem que não tem nada a ver com avaliação.
     * O provisionamento administrativo pode fornecer sua transação local:
     * nesse caso o repositório usa ON CONFLICT, sem abortar o restante dela.
     */
    const work = (tx: PrismaTransactionClient) =>
      this.repository.grantTrial(
        {
          organizationId: input.organizationId,
          planCode: input.planCode,
          legalDocumentFingerprint: impressao,
          startsAt: inicio,
          endsAt: fim,
          riskDecision: TrialRiskDecision.ALLOW,
          ...(input.signals
            ? { riskSignals: input.signals as Prisma.InputJsonValue }
            : {}),
        },
        tx,
        !!transaction,
      );
    const concessao = transaction
      ? await work(transaction)
      : await this.repository.runAsOrganization(input.organizationId, work);

    if (!concessao) {
      /**
       * Log sem o documento e sem a impressão inteira.
       *
       * O prefixo basta para correlacionar duas tentativas no mesmo suporte;
       * a impressão completa num arquivo de log seria a mesma exposição que a
       * coluna do banco evita.
       */
      this.logger.warn(
        JSON.stringify({
          stage: 'trial-denied',
          reason: 'FINGERPRINT_ALREADY_CONSUMED',
          organizationId: input.organizationId,
          fingerprintPrefix: impressao.slice(0, 8),
        }),
      );
      throw new TrialNotEligibleException('fingerprint already consumed');
    }

    return { grantId: concessao.id, startsAt: inicio, endsAt: fim };
  }
}
