import { describe, expect, it } from "vitest";

import { derivarAcoes, mostraAvaliacao } from "./billing-actions";
import type {
  BillingOverview,
  OrganizationSubscription,
} from "@/types/billing";

const assinatura = (
  parcial: Partial<OrganizationSubscription> = {},
): OrganizationSubscription => ({
  id: "sub-1",
  planCode: "PROFESSIONAL",
  planLabel: "Profissional",
  billingInterval: "MONTHLY",
  status: "ACTIVE",
  version: 3,
  billingPeriod: {
    start: "2026-09-15T00:00:00.000Z",
    end: "2026-10-15T00:00:00.000Z",
  },
  usagePeriod: {
    start: "2026-09-15T00:00:00.000Z",
    end: "2026-10-15T00:00:00.000Z",
  },
  trial: null,
  cancelAtPeriodEnd: false,
  pendingChange: null,
  allowedActions: ["CANCEL_AT_PERIOD_END", "CHANGE_PLAN"],
  ...parcial,
});

const visao = (parcial: Partial<BillingOverview> = {}): BillingOverview => ({
  catalog: { plans: [] },
  subscription: assinatura(),
  entitlements: {
    planCode: "PROFESSIONAL",
    label: "Profissional",
    source: "SUBSCRIPTION",
    capabilities: [],
    window: {
      start: "2026-09-15T00:00:00.000Z",
      end: "2026-10-15T00:00:00.000Z",
    },
    allocation: [],
    usage: [],
  },
  billing: {
    configured: true,
    mode: "TEST",
    canCheckout: true,
    canOpenBillingPortal: true,
    allowedActions: ["START_CHECKOUT", "OPEN_BILLING_PORTAL"],
  },
  invoices: [],
  ...parcial,
});

describe("ações de cobrança", () => {
  it("oferece exatamente o que o servidor autorizou", () => {
    const acoes = derivarAcoes(visao());
    expect(acoes.canChangePlan).toBe(true);
    expect(acoes.canCancelRenewal).toBe(true);
    expect(acoes.canKeepSubscription).toBe(false);
    expect(acoes.canOpenBillingPortal).toBe(true);
  });

  it("nenhuma ação nasce do código do plano", () => {
    // O mesmo plano, sem autorização nenhuma: a tela não oferece nada.
    const acoes = derivarAcoes(
      visao({ subscription: assinatura({ allowedActions: [] }) }),
    );
    expect(acoes.canChangePlan).toBe(false);
    expect(acoes.canCancelRenewal).toBe(false);
    expect(acoes.canKeepSubscription).toBe(false);
  });

  it("cancelamento agendado troca o botão pelo de manter", () => {
    const acoes = derivarAcoes(
      visao({
        subscription: assinatura({
          cancelAtPeriodEnd: true,
          allowedActions: ["KEEP_SUBSCRIPTION", "CHANGE_PLAN"],
        }),
      }),
    );
    expect(acoes.canKeepSubscription).toBe(true);
    expect(acoes.canCancelRenewal).toBe(false);
  });

  it("cobrança desligada não oferece contratação nem portal", () => {
    const acoes = derivarAcoes(
      visao({
        billing: {
          configured: false,
          mode: null,
          canCheckout: false,
          canOpenBillingPortal: false,
          allowedActions: [],
        },
      }),
    );
    expect(acoes.canSubscribe).toBe(false);
    expect(acoes.canOpenBillingPortal).toBe(false);
    /** E o resto da página continua funcionando. */
    expect(acoes.canChangePlan).toBe(true);
  });

  it("provedor configurado mas sem autorização não oferece contratar", () => {
    const acoes = derivarAcoes(
      visao({
        billing: {
          configured: true,
          mode: "TEST",
          canCheckout: false,
          canOpenBillingPortal: false,
          allowedActions: [],
        },
      }),
    );
    expect(acoes.canSubscribe).toBe(false);
  });

  it("sem assinatura, só a contratação é possível", () => {
    const acoes = derivarAcoes(visao({ subscription: null }));
    expect(acoes.canSubscribe).toBe(true);
    expect(acoes.canChangePlan).toBe(false);
    expect(acoes.canCancelRenewal).toBe(false);
  });

  it("suspensa: o servidor deixa de autorizar troca, e a tela obedece", () => {
    const acoes = derivarAcoes(
      visao({
        subscription: assinatura({
          status: "SUSPENDED",
          allowedActions: [],
        }),
      }),
    );
    expect(acoes.canChangePlan).toBe(false);
    /** Mas o portal continua aberto: é por ele que se regulariza. */
    expect(acoes.canOpenBillingPortal).toBe(true);
  });

  describe("avaliação gratuita", () => {
    it("só aparece quando o servidor a declara elegível", () => {
      expect(
        mostraAvaliacao(
          assinatura({
            trial: {
              eligible: true,
              trialDays: 30,
              startsAt: null,
              endsAt: null,
            },
          }),
        ),
      ).toBe(true);
    });

    it("não aparece quando já foi consumida", () => {
      // O navegador não sabe *por que* — e não pode saber.
      expect(
        mostraAvaliacao(
          assinatura({
            trial: {
              eligible: false,
              trialDays: 30,
              startsAt: null,
              endsAt: null,
            },
          }),
        ),
      ).toBe(false);
    });

    it("não aparece sem informação de avaliação", () => {
      expect(mostraAvaliacao(assinatura({ trial: null }))).toBe(false);
      expect(mostraAvaliacao(null)).toBe(false);
    });
  });
});
