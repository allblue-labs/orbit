import { describe, expect, it } from "vitest";
import { signupPlanSelection } from "./signup-plan-selection";
import type { PlanCatalog } from "@/types/billing";
const catalog: PlanCatalog = {
  plans: [
    {
      code: "PROFESSIONAL",
      label: "Profissional",
      description: "Plano",
      monthlyPrice: "149.90",
      currency: "BRL",
      capabilities: [],
      allocation: {},
      usage: {},
      prices: {
        MONTHLY: {
          amountMinor: 14990,
          currency: "BRL",
          formatted: "R$ 149,90",
        },
        ANNUAL: {
          amountMinor: 149900,
          currency: "BRL",
          formatted: "R$ 1.499,00",
        },
      },
    },
  ],
};
describe("signup plan selection", () => {
  it("preserves a published plan and selected annual price", () =>
    expect(signupPlanSelection(catalog, "PROFESSIONAL", "ANNUAL")).toEqual({
      planKey: "PROFESSIONAL",
      billingInterval: "ANNUAL",
    }));
  it("supports existing links without a billing interval", () =>
    expect(signupPlanSelection(catalog, "PROFESSIONAL", undefined)).toEqual({
      planKey: "PROFESSIONAL",
      billingInterval: "MONTHLY",
    }));
  it.each([
    [undefined, undefined],
    ["INTERNAL", "MONTHLY"],
    ["PROFESSIONAL", "INVALID"],
    ["PROFESSIONAL", "SEMIANNUAL"],
    [["PROFESSIONAL", "INTERNAL"], "MONTHLY"],
    ["PROFESSIONAL", ["MONTHLY", "ANNUAL"]],
  ])(
    "does not skip selection for an unavailable or ambiguous choice",
    (plan, interval) =>
      expect(signupPlanSelection(catalog, plan, interval)).toEqual({
        planKey: "",
        billingInterval: "MONTHLY",
      }),
  );
});
