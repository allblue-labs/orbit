/**
 * Do vocabulário do provedor para o do Orbit.
 *
 * Num lugar só, de propósito. Espalhar `if (status === 'past_due')` por
 * controllers e workers garantiria que um deles ficasse para trás na primeira
 * mudança de API — e uma tradução esquecida em cobrança vira cliente suspenso
 * por engano.
 *
 * O mapa é **conservador**: estado que este arquivo não conhece vira
 * `UNKNOWN`, e `UNKNOWN` nunca libera plano pago. Um estado novo do provedor
 * deve aparecer como pendência de reconciliação, não como acesso concedido.
 */
import { ProviderBillingState } from '../billing.types';

const MAPA: Readonly<Record<string, ProviderBillingState>> = {
  trialing: ProviderBillingState.TRIALING,
  active: ProviderBillingState.ACTIVE,
  /** Criada sem primeiro pagamento confirmado: não é acesso pago. */
  incomplete: ProviderBillingState.INCOMPLETE,
  incomplete_expired: ProviderBillingState.ENDED,
  /** Cobrança falhou de verdade — distinto de provedor fora do ar. */
  past_due: ProviderBillingState.PAYMENT_FAILED,
  unpaid: ProviderBillingState.PAYMENT_FAILED,
  canceled: ProviderBillingState.ENDED,
  /**
   * Pausada no provedor: sem cobrança e sem garantia de pagamento em dia.
   * Tratada como falha, que na política do Orbit dá carência antes de
   * suspender — o caminho conservador, que não derruba ninguém de imediato.
   */
  paused: ProviderBillingState.PAYMENT_FAILED,
};

export function toProviderBillingState(
  rawStatus: string,
): ProviderBillingState {
  return MAPA[rawStatus] ?? ProviderBillingState.UNKNOWN;
}

/** Estados em que o provedor confirma assinatura paga e em dia. */
export function isPaidState(state: ProviderBillingState): boolean {
  return (
    state === ProviderBillingState.ACTIVE ||
    state === ProviderBillingState.TRIALING
  );
}
