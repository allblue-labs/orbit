import {
  BILLING_INTERVALS,
  type BillingIntervalCode,
  type PlanCatalog,
} from "@/types/billing";

/** Only a published plan and price can skip the plan selection step. */
export function signupPlanSelection(
  catalog: PlanCatalog,
  plan: string | string[] | undefined,
  interval: string | string[] | undefined,
) {
  const billingInterval = interval ?? "MONTHLY";
  const validInterval =
    typeof billingInterval === "string" &&
    BILLING_INTERVALS.includes(billingInterval as BillingIntervalCode);
  const selected =
    typeof plan === "string" && validInterval
      ? catalog.plans.find(
          (entry) => entry.code === plan && entry.prices[billingInterval],
        )
      : undefined;
  return {
    planKey: selected?.code ?? "",
    billingInterval: (selected
      ? billingInterval
      : "MONTHLY") as BillingIntervalCode,
  };
}
