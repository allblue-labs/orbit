import { expect, it } from "vitest";
import { sessionSubscriptionState } from "./subscription-state";
import type { OrganizationSubscription } from "@/types/billing";
import type { SessionEntitlements, SessionOrganization } from "@/types/session";

const now = new Date("2026-10-23T12:00:00Z");
const future = "2026-11-23T12:00:00Z";
const entitlements = {
  planKey: "PROFESSIONAL",
  subscriptionStatus: "TRIALING",
  capabilities: ["*"],
  limits: {},
  currentPeriodStart: now.toISOString(),
  currentPeriodEnd: future,
} satisfies SessionEntitlements;
const subscription = (status: string, trialEnd: string | null = null) =>
  ({
    id: "subscription",
    planCode: "PROFESSIONAL",
    status,
    billingPeriod: { start: now.toISOString(), end: future },
    trial: trialEnd ? { endsAt: trialEnd } : null,
  }) as OrganizationSubscription;

it("new paid account has no granted period even when its quoted billing cycle ends in November", () => {
  const state = sessionSubscriptionState(
    {
      subscription: subscription("PENDING_PAYMENT"),
      entitlements,
      organization: null,
      isPlatformAdmin: false,
    },
    now,
  );
  expect(state).toMatchObject({
    subscriptionStatus: "PENDING_PAYMENT",
    subscriptionActive: false,
    subscriptionEndsAt: null,
    subscriptionTrialEndsAt: null,
  });
});
it("canonical trial ends at its real 30-day deadline, rather than the billing anniversary", () => {
  const state = sessionSubscriptionState(
    {
      subscription: subscription("TRIALING", "2026-11-22T12:00:00Z"),
      entitlements,
      organization: null,
      isPlatformAdmin: false,
    },
    now,
  );
  expect(state).toMatchObject({
    subscriptionActive: true,
    subscriptionEndsAt: "2026-11-22T12:00:00Z",
  });
});
it("an expired trial uses its past end instead of the future billing end", () => {
  const state = sessionSubscriptionState(
    {
      subscription: subscription("EXPIRED", "2026-10-22T12:00:00Z"),
      entitlements,
      organization: null,
      isPlatformAdmin: false,
    },
    now,
  );
  expect(state).toMatchObject({
    subscriptionActive: false,
    subscriptionEndsAt: "2026-10-22T12:00:00Z",
  });
});
it("a failed commercial lookup cannot inherit a legacy trial from the organization", () => {
  const organization = {
    plan: { key: "PROFESSIONAL" },
    subscriptionStatus: "TRIALING",
    currentPeriodEnd: future,
  } as SessionOrganization;
  expect(
    sessionSubscriptionState(
      {
        subscription: null,
        entitlements: null,
        organization,
        isPlatformAdmin: false,
      },
      now,
    ),
  ).toMatchObject({
    subscriptionActive: false,
    subscriptionStatus: "PENDING_PAYMENT",
    subscriptionEndsAt: null,
  });
});
it("keeps bounded grace and platform access", () => {
  expect(
    sessionSubscriptionState(
      {
        subscription: subscription("GRACE_PERIOD"),
        entitlements: null,
        organization: null,
        isPlatformAdmin: false,
      },
      now,
    ).subscriptionActive,
  ).toBe(true);
  expect(
    sessionSubscriptionState(
      {
        subscription: null,
        entitlements: null,
        organization: null,
        isPlatformAdmin: true,
      },
      now,
    ).subscriptionActive,
  ).toBe(true);
});
