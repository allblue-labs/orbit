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
import { Prisma } from '@prisma/client';
import {
  PlanCode,
  type PlanCode as PlanCodeType,
} from '../catalog/plan-catalog.types';
import { TrialNotEligibleException } from './subscription.errors';
import { SubscriptionRepository } from './subscription.repository';
import { TrialFingerprintService } from './trial-fingerprint';
import { TRIAL_DAYS, TrialRiskDecision } from './subscription.types';

const DIA_MS = 24 * 60 * 60_000;

/** Só o plano de entrada tem avaliação. Os demais se contratam direto. */
const PLANOS_COM_AVALIACAO: ReadonlySet<string> = new Set([PlanCode.ESSENTIAL]);

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
  ) {}

  /** O plano oferece avaliação? Pergunta de catálogo, sem tocar no banco. */
  offersTrial(planCode: string): boolean {
    return PLANOS_COM_AVALIACAO.has(planCode);
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
    if (!this.offersTrial(planCode)) {
      return {
        eligible: false,
        trialDays: TRIAL_DAYS,
        internalReason: 'plan does not offer trial',
      };
    }
    const impressao = this.fingerprints.fingerprint(legalDocument);
    const consumida = await this.repository.fingerprintConsumed(impressao);
    return {
      eligible: !consumida,
      trialDays: TRIAL_DAYS,
      internalReason: consumida ? 'fingerprint already consumed' : null,
    };
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
  async grantTrial(input: GrantTrialInput): Promise<GrantedTrial> {
    if (!this.offersTrial(input.planCode)) {
      throw new TrialNotEligibleException(
        `plan ${input.planCode} does not offer trial`,
      );
    }
    const impressao = this.fingerprints.fingerprint(input.legalDocument);
    const inicio = input.at ?? new Date();
    const fim = new Date(inicio.getTime() + TRIAL_DAYS * DIA_MS);

    /**
     * Transação própria, com a organização declarada.
     *
     * Própria porque a recusa vem de uma violação de unicidade, e um erro do
     * Postgres aborta a transação inteira em que acontece: tentar aqui dentro
     * da transação de outra escrita faria essa outra escrita falhar em
     * seguida, com uma mensagem que não tem nada a ver com avaliação.
     */
    const concessao = await this.repository.runAsOrganization(
      input.organizationId,
      (tx) =>
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
        ),
    );

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
