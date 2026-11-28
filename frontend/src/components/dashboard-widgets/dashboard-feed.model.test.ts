import { describe, expect, it } from "vitest";

import type { DashboardFeedItem } from "@/types/dashboard";
import { feedSentence, sinceLabel, whenLabel } from "./dashboard-feed.model";

const TZ = "America/Recife";
/* 22/11/2026, 10:00 em Recife. */
const NOW = new Date("2026-11-22T13:00:00Z");

const item = (extra: Partial<DashboardFeedItem>): DashboardFeedItem => ({
  id: "x",
  kind: "OPERATION",
  event: "COMPLETED",
  entityType: "operation",
  entityId: "op-1",
  code: "OS-1",
  title: "Preventiva",
  customerName: "Clínica Sol",
  personName: "Marina",
  at: NOW.toISOString(),
  allDay: false,
  ...extra,
});

describe("listas do dashboard", () => {
  it("cada evento vira uma frase de operação, com o tom certo", () => {
    expect(feedSentence(item({}))).toEqual({ text: "Atendimento concluído", tone: "success" });
    expect(feedSentence(item({ kind: "QUOTE", event: "REJECTED" }))).toEqual({
      text: "Orçamento recusado",
      tone: "danger",
    });
    expect(feedSentence(item({ kind: "PMOC", event: "DUE" })).text).toBe("Vencimento do PMOC");
    expect(feedSentence(item({ kind: "SERVICE_REQUEST", event: "OPENED" })).text).toBe(
      "Chamado aberto pelo cliente",
    );
  });

  it("o passado é contado de agora para trás, no fuso da unidade", () => {
    expect(sinceLabel("2026-11-22T12:35:00Z", NOW, TZ)).toBe("há 25 min");
    expect(sinceLabel("2026-11-22T10:00:00Z", NOW, TZ)).toBe("há 3 h");
    expect(sinceLabel("2026-11-21T17:20:00Z", NOW, TZ)).toBe("ontem 14:20");
    expect(sinceLabel("2026-11-12T15:00:00Z", NOW, TZ)).toBe("12/11");
  });

  it("o futuro diz hoje, amanhã ou o dia da semana", () => {
    expect(whenLabel({ at: "2026-11-22T17:00:00Z", allDay: false }, NOW, TZ)).toBe("hoje 14:00");
    expect(whenLabel({ at: "2026-11-23T12:00:00Z", allDay: false }, NOW, TZ)).toBe("amanhã 09:00");
    expect(whenLabel({ at: "2026-11-26T11:30:00Z", allDay: false }, NOW, TZ)).toBe("qui 26/11 08:30");
  });

  it("vencimento de dia inteiro não ganha hora nem muda de dia pelo fuso", () => {
    expect(whenLabel({ at: "2026-11-23T00:00:00.000Z", allDay: true }, NOW, TZ)).toBe("amanhã");
    expect(whenLabel({ at: "2026-11-22T00:00:00.000Z", allDay: true }, NOW, TZ)).toBe("hoje");
  });
});
