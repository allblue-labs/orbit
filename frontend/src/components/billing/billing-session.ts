import type { SessionState } from "@/types/session";

export function billingStatus(session: SessionState): string | null {
  return session.authenticated
    ? (session.subscription?.status ??
        session.subscriptionStatus ??
        session.entitlements?.subscriptionStatus ??
        null)
    : null;
}

export function requiresInitialPayment(session: SessionState): boolean {
  return billingStatus(session) === "PENDING_PAYMENT";
}

/** Datas futuras e compras pendentes nunca são um vencimento. */
export function expiredSubscriptionNotice(
  session: SessionState,
  now = new Date(),
) {
  if (
    !session.authenticated ||
    session.subscriptionActive ||
    requiresInitialPayment(session)
  )
    return null;
  const status = billingStatus(session);
  const trialEnd =
    session.subscription?.trial?.endsAt ?? session.subscriptionTrialEndsAt;
  const end =
    (status === "TRIALING" || status === "EXPIRED") && trialEnd
      ? trialEnd
      : session.subscriptionEndsAt;
  if (
    !end ||
    !Number.isFinite(Date.parse(end)) ||
    Date.parse(end) > now.getTime()
  )
    return null;
  return {
    end,
    title:
      status === "TRIALING" || (status === "EXPIRED" && trialEnd)
        ? "Sua avaliação gratuita terminou"
        : "Sua assinatura está inativa",
  };
}
