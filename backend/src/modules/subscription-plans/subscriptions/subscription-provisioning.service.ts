/**
 * A assinatura de uma organização que acaba de nascer.
 *
 * Fica separada do serviço de comandos porque o momento é outro: aqui não há
 * assinatura anterior, não há versão a conferir e não há cliente esperando uma
 * resposta de cobrança — há uma empresa que acabou de se cadastrar e precisa
 * conseguir usar o produto.
 *
 * ## A avaliação é tentada, não exigida
 *
 * Se o documento já consumiu a avaliação, o cadastro **não falha**: a
 * organização nasce aguardando pagamento e segue para a contratação.
 * Derrubar um cadastro legítimo porque o sócio já testou noutra empresa seria
 * transformar o antifraude em porta trancada.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  BillingInterval,
  PlanCode,
  type BillingInterval as BillingIntervalType,
  type PlanCode as PlanCodeType,
} from '../catalog/plan-catalog.types';
import { isKnownPlan } from '../catalog/plan-registry';
import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';
import { TrialEligibilityService } from './trial-eligibility.service';

export interface ProvisionInput {
  organizationId: string;
  planKey: string;
  legalDocument: string;
  billingInterval?: BillingIntervalType;
  at?: Date;
}

@Injectable()
export class SubscriptionProvisioningService {
  private readonly logger = new Logger(SubscriptionProvisioningService.name);

  constructor(
    private readonly subscriptions: SubscriptionService,
    private readonly trials: TrialEligibilityService,
    private readonly repository: SubscriptionRepository,
  ) {}

  /**
   * Provisiona a assinatura do cadastro.
   *
   * Planos que não são do catálogo — fixtures de teste, acesso interno — não
   * ganham assinatura comercial: continuam resolvendo pelo caminho legado, que
   * é o que já eram. Inventar um contrato para um fixture faria a plataforma
   * cobrar de si mesma.
   */
  async provision(input: ProvisionInput): Promise<void> {
    if (!isKnownPlan(input.planKey)) {
      this.logger.log(
        JSON.stringify({
          stage: 'subscription-skipped',
          reason: 'NON_CATALOG_PLAN',
          organizationId: input.organizationId,
          planKey: input.planKey,
        }),
      );
      return;
    }

    const planCode = input.planKey;
    const inicio = input.at ?? new Date();

    /**
     * A avaliação primeiro, na transação dela.
     *
     * Separada de propósito: a recusa vem de uma violação de unicidade, e um
     * erro do Postgres aborta a transação inteira em que acontece — tentar e
     * seguir dentro da mesma transação deixaria a criação da assinatura falhar
     * com "transação abortada", que foi o `500` da primeira execução. Duas
     * transações também são honestas quanto ao domínio: conceder avaliação e
     * criar assinatura são fatos separáveis.
     */
    const trial = await this.tentarAvaliacao(
      input.organizationId,
      planCode,
      input.legalDocument,
      inicio,
    );

    /**
     * A assinatura, com a organização declarada.
     *
     * O cadastro é público e ainda não há requisição autenticada: sem declarar
     * o inquilino, a política de RLS recusa a linha. É o mesmo caminho que o
     * repositório de registro já usa para escrever as primeiras linhas de um
     * inquilino que acabou de nascer.
     */
    await this.repository.runAsOrganization(
      input.organizationId,
      (transaction) =>
        this.subscriptions.create(
          {
            organizationId: input.organizationId,
            planCode,
            billingInterval: input.billingInterval ?? BillingInterval.MONTHLY,
            startsAt: inicio,
            access: trial
              ? { kind: 'TRIAL', ...trial }
              : { kind: 'PAYMENT_REQUIRED' },
          },
          transaction,
        ),
    );
  }

  private async tentarAvaliacao(
    organizationId: string,
    planCode: PlanCodeType,
    legalDocument: string,
    at: Date,
  ): Promise<{ startsAt: Date; endsAt: Date } | null> {
    if (planCode !== PlanCode.ESSENTIAL) return null;
    try {
      const concedida = await this.trials.grantTrial({
        organizationId,
        planCode,
        legalDocument,
        at,
      });
      return { startsAt: concedida.startsAt, endsAt: concedida.endsAt };
    } catch {
      /**
       * Recusada — e o cadastro continua.
       *
       * O motivo já foi registrado por quem recusou, sem documento e sem
       * impressão inteira. Aqui não se registra de novo nem se propaga: quem
       * está se cadastrando não precisa saber que outra empresa com o mesmo
       * sócio testou o Orbit no ano passado.
       */
      return null;
    }
  }
}
