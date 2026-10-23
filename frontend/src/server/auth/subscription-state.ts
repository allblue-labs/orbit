import { assinaturaVigente } from "@/components/billing/subscription-status";
import type { OrganizationSubscription } from "@/types/billing";
import type { SessionEntitlements, SessionOrganization } from "@/types/session";

const COMMERCIAL_PLANS = new Set([
  "ESSENTIAL",
  "PROFESSIONAL",
  "PROFESSIONAL_INTELLIGENCE",
  "ENTERPRISE_UNLIMITED",
]);

/** O ciclo cotado de uma compra pendente não é um período de acesso concedido. */
export function sessionSubscriptionState(
  input: {
    subscription: OrganizationSubscription | null;
    entitlements: SessionEntitlements | null;
    organization: SessionOrganization | null;
    isPlatformAdmin: boolean;
  },
  now = new Date(),
) {
  const { subscription, entitlements, organization } = input;
  const legacyCommercial =
    organization?.plan && COMMERCIAL_PLANS.has(organization.plan.key);
  const status =
    subscription?.status ??
    entitlements?.subscriptionStatus ??
    (legacyCommercial
      ? "PENDING_PAYMENT"
      : (organization?.subscriptionStatus ?? null));
  const trialEndsAt =
    subscription?.trial?.endsAt ??
    (status === "TRIALING" ? (entitlements?.currentPeriodEnd ?? null) : null);
  const periodEnd =
    subscription?.billingPeriod.end ??
    entitlements?.currentPeriodEnd ??
    organization?.currentPeriodEnd ??
    null;
  const end =
    status === "PENDING_PAYMENT"
      ? null
      : status === "TRIALING" || status === "EXPIRED"
        ? (trialEndsAt ?? periodEnd)
        : periodEnd;
  return {
    subscription,
    subscriptionStatus: status,
    subscriptionTrialEndsAt: trialEndsAt,
    subscriptionEndsAt: end,
    subscriptionActive: status
      ? assinaturaVigente(status, end, now)
      : input.isPlatformAdmin,
  };
}
