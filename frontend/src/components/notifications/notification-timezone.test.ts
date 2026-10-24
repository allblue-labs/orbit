import { describe, expect, it } from "vitest";
import { groupByDay } from "./notification-presentation";

describe("notification days in the account timezone", () => {
  it("groups and labels today and yesterday using the selected timezone", () => {
    const now = new Date("2026-10-24T06:00:00Z");
    const items = [
      { id: "early", createdAt: "2026-10-24T03:30:00Z" },
      { id: "late", createdAt: "2026-10-24T05:30:00Z" },
    ];
    expect(groupByDay(items, "America/Rio_Branco", now)).toEqual([
      { key: "2026-10-24", label: "Hoje", ids: ["late"] },
      { key: "2026-10-23", label: "Ontem", ids: ["early"] },
    ]);
    expect(groupByDay(items, "America/Recife", now)).toEqual([
      { key: "2026-10-24", label: "Hoje", ids: ["early", "late"] },
    ]);
  });
});
