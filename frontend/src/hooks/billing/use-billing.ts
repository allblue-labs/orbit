"use client";

/**
 * Query Layer de plano e assinatura.
 *
 * ## Sem atualização otimista
 *
 * Toda escrita aqui pode ser recusada por motivo que o cliente não enxerga:
 * versão vencida, estado que não permite a mudança, provedor indisponível.
 * Antecipar o resultado mostraria um plano que o servidor talvez não conceda —
 * e num lugar onde o número na tela é o que a empresa vai pagar.
 *
 * Depois de qualquer comando, a leitura consolidada é invalidada e refeita: o
 * estado exibido é sempre o que o servidor confirmou.
 */
import { CACHE } from "@/hooks/api/cache-policy";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { billingService } from "@/services/billing.service";
import type {
  ChangePlanInput,
  CreateCheckoutInput,
  SubscriptionVersionInput,
} from "@/types/billing";

/**
 * A visão consolidada.
 *
 * `fresh` porque uma contratação recém-concluída pelo provedor converge por
 * webhook, e a tela precisa perceber a mudança sem que a pessoa recarregue a
 * página na mão.
 */
export function useBillingOverview() {
  return useApiQuery(
    billingService.keys.overview(),
    ({ signal }) => billingService.overview({ signal }),
    CACHE.fresh,
  );
}

/**
 * Abre a contratação e devolve a URL do provedor.
 *
 * Não invalida nada: nada mudou ainda. Abrir a tela de pagamento não é
 * contratar, e assumir o contrário mostraria um plano que ninguém pagou.
 */
export function useCreateCheckout() {
  return useApiMutation<
    Awaited<ReturnType<typeof billingService.createCheckout>>,
    CreateCheckoutInput
  >((input) => billingService.createCheckout(input));
}

export function useOpenBillingPortal() {
  return useApiMutation<
    Awaited<ReturnType<typeof billingService.openPortal>>,
    void
  >(() => billingService.openPortal());
}

export function useCancelRenewal() {
  return useApiMutation<
    Awaited<ReturnType<typeof billingService.cancelRenewal>>,
    SubscriptionVersionInput
  >((input) => billingService.cancelRenewal(input), {
    invalidate: [billingService.keys.module()],
  });
}

export function useKeepSubscription() {
  return useApiMutation<
    Awaited<ReturnType<typeof billingService.keepSubscription>>,
    SubscriptionVersionInput
  >((input) => billingService.keepSubscription(input), {
    invalidate: [billingService.keys.module()],
  });
}

export function useChangePlan() {
  return useApiMutation<
    Awaited<ReturnType<typeof billingService.changePlan>>,
    ChangePlanInput
  >((input) => billingService.changePlan(input), {
    invalidate: [billingService.keys.module()],
  });
}

export function useCancelScheduledChange() {
  return useApiMutation<
    Awaited<ReturnType<typeof billingService.cancelScheduledChange>>,
    SubscriptionVersionInput
  >((input) => billingService.cancelScheduledChange(input), {
    invalidate: [billingService.keys.module()],
  });
}
