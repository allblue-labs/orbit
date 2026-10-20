/**
 * O que a tela precisa saber sobre cobrança.
 *
 * Sem segredo, sem identificador do provedor, sem evento e sem erro interno.
 * O suficiente para a PR-PL-04 desenhar uma página honesta — inclusive quando
 * a cobrança está desligada, caso em que a resposta é "indisponível", e não um
 * erro técnico na cara de quem estava só olhando o plano.
 */
import { Inject, Injectable } from '@nestjs/common';
import { EntitlementService } from '../subscription-plans/entitlements/entitlement.service';
import { SubscriptionMapper } from '../subscription-plans/subscriptions/subscription.mapper';
import { SubscriptionService } from '../subscription-plans/subscriptions/subscription.service';
import type { OrganizationSubscriptionReadModel } from '../subscription-plans/subscriptions/subscription.read-models';
import type {
  OrganizationEntitlementsReadModel,
  PlanCatalogReadModel,
} from '../subscription-plans/subscription-plan.read-models';
import { allowsInitialCheckout } from '../subscription-plans/subscriptions/subscription.types';
import { BillingRepository } from './billing.repository';
import { BILLING_PROVIDER, type BillingProvider } from './billing.types';

/**
 * Tudo o que a tela de plano precisa, numa leitura.
 *
 * Quatro leituras separadas — catálogo, assinatura, direitos e prontidão —
 * fariam a página abrir com quatro estados de carregamento e quatro
 * oportunidades de mostrar um pedaço inconsistente do outro. Aqui elas são
 * agregadas, e nada é decidido: cada parte continua vindo de quem já era dona
 * dela.
 */
export interface BillingOverviewReadModel {
  catalog: PlanCatalogReadModel;
  /** `null` para organização sem assinatura — legado da PR-PL-02. */
  subscription: OrganizationSubscriptionReadModel | null;
  entitlements: OrganizationEntitlementsReadModel;
  billing: BillingReadinessReadModel;
  invoices: readonly BillingInvoiceReadModel[];
}

export interface BillingInvoiceReadModel {
  id: string;
  number: string | null;
  status: string;
  currency: string;
  totalMinor: number;
  amountPaidMinor: number;
  amountRemainingMinor: number;
  creditNotesMinor: number;
  attemptCount: number;
  period: { start: string; end: string };
  dueAt: string | null;
  nextPaymentAttemptAt: string | null;
  paidAt: string | null;
  issuedAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  adjustments: readonly BillingFinancialAdjustmentReadModel[];
}

export interface BillingFinancialAdjustmentReadModel {
  id: string;
  type: string;
  status: string;
  amountMinor: number;
  currency: string;
  reason: string | null;
  occurredAt: string;
}

export interface BillingReadinessReadModel {
  /** A integração está configurada neste ambiente? */
  configured: boolean;
  /** `TEST` ou `LIVE`, e só fora de produção interessa a quem opera. */
  mode: string | null;
  canCheckout: boolean;
  canOpenBillingPortal: boolean;
  allowedActions: readonly string[];
}

@Injectable()
export class BillingReadService {
  constructor(
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    private readonly repository: BillingRepository,
    private readonly subscriptions: SubscriptionService,
    private readonly entitlements: EntitlementService,
    private readonly subscriptionMapper: SubscriptionMapper,
  ) {}

  /**
   * A visão consolidada.
   *
   * Agrega leituras que já existiam; não calcula preço, não decide ação e não
   * inventa estado. A assinatura ausente é `null`, e não um erro: uma
   * organização anterior à PR-PL-02 continua funcionando pelo caminho legado.
   */
  async overview(organizationId: string): Promise<BillingOverviewReadModel> {
    const assinatura = await this.subscriptions.currentOrNull(organizationId);
    return {
      catalog: this.entitlements.catalog(),
      subscription: assinatura
        ? this.subscriptionMapper.details(assinatura)
        : null,
      entitlements: await this.entitlements.describe(organizationId),
      billing: await this.readiness(organizationId),
      invoices: (await this.repository.recentInvoices(organizationId)).map(
        (invoice) => ({
          id: invoice.id,
          number: invoice.invoiceNumber,
          status: invoice.status,
          currency: invoice.currency,
          totalMinor: invoice.totalMinor,
          amountPaidMinor: invoice.amountPaidMinor,
          amountRemainingMinor: invoice.amountRemainingMinor,
          creditNotesMinor: invoice.creditNotesMinor,
          attemptCount: invoice.attemptCount,
          period: {
            start: invoice.periodStart.toISOString(),
            end: invoice.periodEnd.toISOString(),
          },
          dueAt: invoice.dueAt?.toISOString() ?? null,
          nextPaymentAttemptAt:
            invoice.nextPaymentAttemptAt?.toISOString() ?? null,
          paidAt: invoice.paidAt?.toISOString() ?? null,
          issuedAt: invoice.providerCreatedAt.toISOString(),
          hostedInvoiceUrl: invoice.hostedInvoiceUrl,
          invoicePdfUrl: invoice.invoicePdfUrl,
          adjustments: invoice.adjustments.map((adjustment) => ({
            id: adjustment.id,
            type: adjustment.type,
            status: adjustment.status,
            amountMinor: adjustment.amountMinor,
            currency: adjustment.currency,
            reason: adjustment.reason,
            occurredAt: adjustment.occurredAt.toISOString(),
          })),
        }),
      ),
    };
  }

  async readiness(organizationId: string): Promise<BillingReadinessReadModel> {
    const configurada = this.provider.isEnabled();
    if (!configurada) {
      return {
        configured: false,
        mode: null,
        canCheckout: false,
        canOpenBillingPortal: false,
        allowedActions: [],
      };
    }

    const assinatura = await this.subscriptions.currentOrNull(organizationId);
    const cliente = await this.repository.findCustomer(
      organizationId,
      this.provider.name,
      this.provider.mode,
    );

    const podeContratar =
      assinatura === null || allowsInitialCheckout(assinatura.effectiveStatus);
    /** Sem cliente no provedor não há portal para abrir — ele nasce no checkout. */
    const podeAbrirPortal = cliente !== null;

    return {
      configured: true,
      mode: this.provider.mode,
      canCheckout: podeContratar,
      canOpenBillingPortal: podeAbrirPortal,
      allowedActions: [
        ...(podeContratar ? ['START_CHECKOUT'] : []),
        ...(podeAbrirPortal ? ['OPEN_BILLING_PORTAL'] : []),
      ],
    };
  }
}
