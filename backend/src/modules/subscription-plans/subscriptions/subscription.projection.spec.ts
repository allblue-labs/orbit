import { BillingInterval } from '../catalog/plan-catalog.types';
import { project, type SubscriptionState } from './subscription.projection';
import { SubscriptionStatus } from './subscription.types';

const iso = (value: string) => new Date(value);

const base: SubscriptionState = {
  status: SubscriptionStatus.ACTIVE,
  billingInterval: BillingInterval.MONTHLY,
  billingAnchorAt: iso('2026-09-15T00:00:00.000Z'),
  currentPeriodStart: iso('2026-09-15T00:00:00.000Z'),
  currentPeriodEnd: iso('2026-10-15T00:00:00.000Z'),
  trialEndsAt: null,
  graceStartsAt: null,
  graceEndsAt: null,
  providerManaged: true,
  cancelAtPeriodEnd: false,
  pendingEffectiveAt: null,
};

describe('projeção do estado da assinatura', () => {
  it('dentro do período, nada muda', () => {
    const projetado = project(base, iso('2026-10-01T00:00:00.000Z'));
    expect(projetado.status).toBe(SubscriptionStatus.ACTIVE);
    expect(projetado.changed).toBe(false);
  });

  describe('avaliação', () => {
    const emAvaliacao: SubscriptionState = {
      ...base,
      status: SubscriptionStatus.TRIALING,
      trialEndsAt: iso('2026-10-15T00:00:00.000Z'),
    };

    it('vale até o último instante', () => {
      expect(project(emAvaliacao, iso('2026-10-14T23:59:59.000Z')).status).toBe(
        SubscriptionStatus.TRIALING,
      );
    });

    it('vence e não se converte sozinha', () => {
      const projetado = project(emAvaliacao, iso('2026-10-15T00:00:00.000Z'));
      expect(projetado.status).toBe(SubscriptionStatus.EXPIRED);
      expect(projetado.changed).toBe(true);
    });

    it('o atraso do reconciliador não dá tempo extra', () => {
      // Três horas depois do vencimento, o estado é o mesmo do instante exato.
      expect(project(emAvaliacao, iso('2026-10-15T03:00:00.000Z')).status).toBe(
        SubscriptionStatus.EXPIRED,
      );
    });
  });

  describe('carência', () => {
    const emCarencia: SubscriptionState = {
      ...base,
      status: SubscriptionStatus.GRACE_PERIOD,
      graceEndsAt: iso('2026-10-05T00:00:00.000Z'),
    };

    it('mantém o acesso enquanto corre', () => {
      expect(project(emCarencia, iso('2026-10-04T00:00:00.000Z')).status).toBe(
        SubscriptionStatus.GRACE_PERIOD,
      );
    });

    it('termina em suspensão, sem destruir nada', () => {
      expect(project(emCarencia, iso('2026-10-05T00:00:00.000Z')).status).toBe(
        SubscriptionStatus.SUSPENDED,
      );
    });
  });

  describe('cancelamento agendado', () => {
    it('mantém o acesso até o fim do período pago', () => {
      const cancelada = { ...base, cancelAtPeriodEnd: true };
      expect(project(cancelada, iso('2026-10-14T00:00:00.000Z')).status).toBe(
        SubscriptionStatus.ACTIVE,
      );
      expect(project(cancelada, iso('2026-10-15T00:00:00.000Z')).status).toBe(
        SubscriptionStatus.CANCELED,
      );
    });

    it('num contrato anual, o acesso vai até o fim do ano contratado', () => {
      const anual: SubscriptionState = {
        ...base,
        billingInterval: BillingInterval.ANNUAL,
        currentPeriodEnd: iso('2027-09-15T00:00:00.000Z'),
        cancelAtPeriodEnd: true,
      };
      expect(project(anual, iso('2027-06-01T00:00:00.000Z')).status).toBe(
        SubscriptionStatus.ACTIVE,
      );
      expect(project(anual, iso('2027-09-15T00:00:00.000Z')).status).toBe(
        SubscriptionStatus.CANCELED,
      );
    });
  });

  describe('renovação', () => {
    it('contrato do provedor entra em carência sem pagamento confirmado', () => {
      const projetado = project(base, iso('2026-10-20T00:00:00.000Z'));
      expect(projetado.status).toBe(SubscriptionStatus.GRACE_PERIOD);
      expect(projetado.renewed).toBe(false);
      expect(projetado.graceStartsAt?.toISOString()).toBe(
        '2026-10-15T00:00:00.000Z',
      );
      expect(projetado.graceEndsAt?.toISOString()).toBe(
        '2026-10-22T00:00:00.000Z',
      );
    });

    it('carência implícita também é limitada quando o worker para', () => {
      const projetado = project(base, iso('2027-02-20T00:00:00.000Z'));
      expect(projetado.status).toBe(SubscriptionStatus.SUSPENDED);
      expect(projetado.renewed).toBe(false);
    });

    it('contrato legado sem provedor preserva a renovação anterior', () => {
      const projetado = project(
        { ...base, providerManaged: false },
        iso('2027-02-20T00:00:00.000Z'),
      );
      expect(projetado.status).toBe(SubscriptionStatus.ACTIVE);
      expect(projetado.renewed).toBe(true);
      expect(projetado.currentPeriodStart.toISOString()).toBe(
        '2027-02-15T00:00:00.000Z',
      );
      expect(projetado.currentPeriodEnd.toISOString()).toBe(
        '2027-03-15T00:00:00.000Z',
      );
    });
  });

  describe('mudança programada', () => {
    it('só vale a partir da data marcada', () => {
      const comPendencia = {
        ...base,
        pendingEffectiveAt: iso('2026-10-15T00:00:00.000Z'),
      };
      expect(
        project(comPendencia, iso('2026-10-14T00:00:00.000Z')).pendingApplied,
      ).toBe(false);
      expect(
        project(comPendencia, iso('2026-10-15T00:00:00.000Z')).pendingApplied,
      ).toBe(true);
    });
  });

  it('projetar duas vezes dá o mesmo resultado', () => {
    const instante = iso('2026-11-20T00:00:00.000Z');
    expect(project(base, instante)).toEqual(project(base, instante));
  });
});
