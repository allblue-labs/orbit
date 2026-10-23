import { expect, it } from "vitest";
import {
  expiredSubscriptionNotice,
  requiresInitialPayment,
} from "./billing-session";
import { requireBillingRedirect } from "./billing-redirect";
import type { AuthenticatedSession } from "@/types/session";

const now = new Date("2026-10-23T12:00:00Z");
const session = (status: string | null, end = "2026-11-23T12:00:00Z") =>
  ({
    authenticated: true,
    subscriptionActive: false,
    subscriptionStatus: status,
    subscriptionEndsAt: end,
    entitlements: null,
  }) as AuthenticatedSession;
it("never says that October 23 is past a November 23 expiry", () => {
  expect(expiredSubscriptionNotice(session("EXPIRED"), now)).toBeNull();
  expect(expiredSubscriptionNotice(session(null), now)).toBeNull();
});
it("pending account is not an expired trial, even when entitlements could not load", () => {
  const state = session("PENDING_PAYMENT", "2026-10-22T12:00:00Z");
  expect(requiresInitialPayment(state)).toBe(true);
  expect(expiredSubscriptionNotice(state, now)).toBeNull();
});
it("uses the real expired trial date", () => {
  const state = {
    ...session("EXPIRED"),
    subscriptionTrialEndsAt: "2026-10-22T12:00:00Z",
  };
  expect(expiredSubscriptionNotice(state, now)).toEqual({
    title: "Sua avaliação gratuita terminou",
    end: "2026-10-22T12:00:00Z",
  });
});
it("does not mislabel a canceled paid subscription as a trial", () => {
  expect(
    expiredSubscriptionNotice(session("CANCELED", "2026-10-22T12:00:00Z"), now)
      ?.title,
  ).toBe("Sua assinatura está inativa");
});
it.each([
  {},
  undefined,
  { planCode: "PROFESSIONAL", status: "ACTIVE" },
  { url: "javascript:alert(1)" },
  { url: "https://user:password@example.test" },
])("rejects missing or unsafe payment redirects: %j", (result) => {
  expect(() => requireBillingRedirect(result as { url: string })).toThrow(
    "O pagamento não retornou um endereço válido",
  );
});
it("preserves a valid checkout payload", () => {
  const result = {
    url: "https://checkout.stripe.com/pay/session",
    expiresAt: null,
  };
  expect(requireBillingRedirect(result)).toBe(result);
});
