/**
 * Serviço de plano, assinatura e cobrança.
 *
 * Uma leitura consolidada e cinco comandos. Nenhuma regra vive aqui: o corpo
 * de cada comando carrega o mínimo, e o servidor decide o resto — inclusive
 * se o comando é permitido.
 */
import { apiClient } from "@/api/client";
import { requireBillingRedirect } from "@/components/billing/billing-redirect";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { RequestOptions } from "@/types/api";
import type {
  BillingOverview,
  BillingPortalResult,
  ChangePlanInput,
  ChangePlanResult,
  CheckoutSessionResult,
  CreateCheckoutInput,
  OrganizationSubscription,
  SubscriptionVersionInput,
  CancelSubscriptionInput,
} from "@/types/billing";

const RESOURCE = "billing";

export const billingService = {
  keys: {
    overview: (): QueryKey => queryKeys.list(RESOURCE, { view: "overview" }),
    module: (): QueryKey => queryKeys.module(RESOURCE),
  },

  overview: (options?: RequestOptions): Promise<BillingOverview> =>
    apiClient.get<BillingOverview>("/billing/overview", options),

  /**
   * Abre a contratação.
   *
   * O corpo leva plano e periodicidade. Valor, moeda, identificador de preço,
   * dias de avaliação e organização não são enviados — e se fossem, o servidor
   * recusaria a requisição inteira.
   */
  createCheckout: (
    input: CreateCheckoutInput,
  ): Promise<CheckoutSessionResult> =>
    apiClient
      .post<CheckoutSessionResult>("/billing/checkout-session", input)
      .then(requireBillingRedirect),

  openPortal: (): Promise<BillingPortalResult> =>
    apiClient
      .post<BillingPortalResult>("/billing/portal-session", {})
      .then(requireBillingRedirect),

  cancelRenewal: (
    input: CancelSubscriptionInput,
  ): Promise<OrganizationSubscription> =>
    apiClient.post<OrganizationSubscription>(
      "/organizations/current/subscription/cancel",
      input,
    ),

  keepSubscription: (
    input: SubscriptionVersionInput,
  ): Promise<OrganizationSubscription> =>
    apiClient.post<OrganizationSubscription>(
      "/organizations/current/subscription/keep",
      input,
    ),

  changePlan: (input: ChangePlanInput): Promise<ChangePlanResult> =>
    apiClient
      .post<ChangePlanResult>(
        "/organizations/current/subscription/change-plan",
        input,
      )
      .then((result) => {
        if (
          "kind" in result &&
          (result.kind === "TRIAL_STARTED" || result.kind === "SCHEDULED")
        )
          return result;
        return requireBillingRedirect(result as BillingPortalResult);
      }),

  cancelScheduledChange: (
    input: SubscriptionVersionInput,
  ): Promise<OrganizationSubscription> =>
    apiClient.post<OrganizationSubscription>(
      "/organizations/current/subscription/cancel-scheduled-change",
      input,
    ),
};
