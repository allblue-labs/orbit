const KEY = "orbit:billing-target";
import { ApiError } from "@/lib/api-error";

export function requireBillingRedirect<T extends { url: string }>(
  result: T,
): T {
  try {
    const url = new URL(result?.url);
    if (url.protocol === "https:" && !url.username && !url.password)
      return result;
  } catch {
    /* Resposta incompatível ou incompleta. */
  }
  throw new ApiError({
    kind: "parse",
    code: "BILLING_REDIRECT_MISSING",
    message:
      "O pagamento não retornou um endereço válido. Atualize a página e tente novamente. Se persistir, informe o suporte.",
  });
}

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
