const KEY = "orbit:billing-target";

export interface BillingRedirectTarget {
  subscriptionId: string;
  planCode: string;
  billingInterval: string;
}

/** Somente navegação: nunca concede plano, teste ou acesso. */
export function rememberBillingTarget(target: BillingRedirectTarget) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(target));
  } catch {
    /* armazenamento opcional */
  }
}

export function readBillingTarget(): BillingRedirectTarget | null {
  try {
    const target = JSON.parse(
      sessionStorage.getItem(KEY) ?? "null",
    ) as BillingRedirectTarget | null;
    return target &&
      typeof target.subscriptionId === "string" &&
      typeof target.planCode === "string" &&
      typeof target.billingInterval === "string"
      ? target
      : null;
  } catch {
    return null;
  }
}

export function clearBillingTarget() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* armazenamento opcional */
  }
}
