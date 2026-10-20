import { ProviderBillingState } from '../billing.types';
import { isPaidState, toProviderBillingState } from './stripe-status.mapper';

describe('tradução do estado do provedor', () => {
  it.each([
    ['trialing', ProviderBillingState.TRIALING],
    ['active', ProviderBillingState.ACTIVE],
    ['past_due', ProviderBillingState.PAYMENT_FAILED],
    ['unpaid', ProviderBillingState.PAYMENT_FAILED],
    ['paused', ProviderBillingState.PAYMENT_FAILED],
    ['canceled', ProviderBillingState.ENDED],
    ['incomplete_expired', ProviderBillingState.ENDED],
    ['incomplete', ProviderBillingState.INCOMPLETE],
  ])('%s vira %s', (bruto, esperado) => {
    expect(toProviderBillingState(bruto)).toBe(esperado);
  });

  it('estado desconhecido nunca vira acesso', () => {
    // Um estado novo do provedor deve aparecer como pendência, não como plano
    // pago liberado por omissão.
    for (const inventado of ['ativo', 'ACTIVE', 'renewing', '']) {
      const estado = toProviderBillingState(inventado);
      expect(estado).toBe(ProviderBillingState.UNKNOWN);
      expect(isPaidState(estado)).toBe(false);
    }
  });

  it('assinatura sem primeiro pagamento não é assinatura paga', () => {
    expect(isPaidState(toProviderBillingState('incomplete'))).toBe(false);
  });

  it('só em dia e em avaliação contam como pagas', () => {
    expect(isPaidState(ProviderBillingState.ACTIVE)).toBe(true);
    expect(isPaidState(ProviderBillingState.TRIALING)).toBe(true);
    expect(isPaidState(ProviderBillingState.PAYMENT_FAILED)).toBe(false);
    expect(isPaidState(ProviderBillingState.ENDED)).toBe(false);
  });
});
