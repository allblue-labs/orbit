/**
 * O estado da assinatura **agora**, calculado a partir do que está guardado.
 *
 * ## Por que uma função pura, e não só um job
 *
 * Se o estado dependesse de um job ter rodado no segundo certo, um worker
 * parado por três horas daria três horas de acesso grátis a quem venceu — e
 * negaria acesso a quem renovou. Aqui o relógio é argumento: a mesma linha,
 * lida às 9h ou às 12h, produz o estado correto das duas vezes.
 *
 * O reconciliador aplica exatamente esta função e **persiste** o resultado, de
 * modo que o banco espelhe a verdade e a auditoria tenha o momento. Mas a
 * leitura de direitos nunca espera por ele: worker atrasado não muda o que o
 * cliente pode fazer.
 */
import {
  BILLING_INTERVAL_MONTHS,
  type BillingInterval,
} from '../catalog/plan-catalog.types';
import { anchoredPeriod } from '../entitlements/anchored-period';
import { GRACE_PERIOD_DAYS, SubscriptionStatus } from './subscription.types';

export interface SubscriptionState {
  readonly status: SubscriptionStatus;
  readonly billingInterval: BillingInterval;
  readonly billingAnchorAt: Date;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly trialEndsAt: Date | null;
  readonly graceStartsAt: Date | null;
  readonly graceEndsAt: Date | null;
  /** `true` quando a renovação depende de confirmação financeira externa. */
  readonly providerManaged: boolean;
  readonly cancelAtPeriodEnd: boolean;
  readonly pendingEffectiveAt: Date | null;
}

export interface ProjectedSubscription {
  readonly status: SubscriptionStatus;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly graceStartsAt: Date | null;
  readonly graceEndsAt: Date | null;
  /** A mudança programada já venceu e vale a partir de agora. */
  readonly pendingApplied: boolean;
  /** O período rolou sozinho — renovação implícita até a PR-PL-03 existir. */
  readonly renewed: boolean;
  /** A linha guardada difere do estado real e merece ser reconciliada. */
  readonly changed: boolean;
}

export function project(
  state: SubscriptionState,
  at: Date,
): ProjectedSubscription {
  let status = state.status;
  let { currentPeriodStart, currentPeriodEnd } = state;
  let graceStartsAt = state.graceStartsAt;
  let graceEndsAt = state.graceEndsAt;
  let renewed = false;

  /**
   * A avaliação acabou.
   *
   * Não converte sozinha em assinatura paga: contratar é ato de quem compra, e
   * a PR-PL-03 é que ligará o checkout. Sem isso, o teste vira acesso perpétuo.
   */
  if (
    status === SubscriptionStatus.TRIALING &&
    state.trialEndsAt !== null &&
    state.trialEndsAt <= at
  ) {
    status = SubscriptionStatus.EXPIRED;
  }

  /** A carência acabou. Suspende — sem apagar nada. */
  if (
    status === SubscriptionStatus.GRACE_PERIOD &&
    state.graceEndsAt !== null &&
    state.graceEndsAt <= at
  ) {
    status = SubscriptionStatus.SUSPENDED;
  }

  /**
   * O período contratado terminou.
   *
   * Com cancelamento agendado, é aqui que ele acontece — nunca antes: quem
   * cancelou no dia 2 de um plano anual continua até o fim do que já pagou.
   * Sem cancelamento, contratos antigos sem provedor mantêm o comportamento
   * legado. Contratos geridos pelo provedor **nunca** renovam só porque o
   * relógio passou: entram numa carência curta enquanto a confirmação de
   * pagamento não chega. Isso fecha a falha em que uma interrupção do worker
   * concedia outro mês ou ano inteiro gratuitamente.
   */
  if (
    (status === SubscriptionStatus.ACTIVE ||
      status === SubscriptionStatus.TRIALING) &&
    currentPeriodEnd <= at
  ) {
    if (state.cancelAtPeriodEnd) {
      status = SubscriptionStatus.CANCELED;
    } else if (status === SubscriptionStatus.ACTIVE && state.providerManaged) {
      graceStartsAt = currentPeriodEnd;
      graceEndsAt = new Date(
        currentPeriodEnd.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60_000,
      );
      status =
        at >= graceEndsAt
          ? SubscriptionStatus.SUSPENDED
          : SubscriptionStatus.GRACE_PERIOD;
    } else if (status === SubscriptionStatus.ACTIVE) {
      const periodo = anchoredPeriod(
        state.billingAnchorAt,
        BILLING_INTERVAL_MONTHS[state.billingInterval] ?? 1,
        at,
      );
      currentPeriodStart = periodo.start;
      currentPeriodEnd = periodo.end;
      renewed = true;
    }
  }

  const pendingApplied =
    state.pendingEffectiveAt !== null && state.pendingEffectiveAt <= at;

  return {
    status,
    currentPeriodStart,
    currentPeriodEnd,
    graceStartsAt,
    graceEndsAt,
    pendingApplied,
    renewed,
    changed:
      status !== state.status ||
      renewed ||
      pendingApplied ||
      graceStartsAt?.getTime() !== state.graceStartsAt?.getTime() ||
      graceEndsAt?.getTime() !== state.graceEndsAt?.getTime() ||
      currentPeriodStart.getTime() !== state.currentPeriodStart.getTime(),
  };
}
