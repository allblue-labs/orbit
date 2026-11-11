import { describe, expect, it } from "vitest";
import { recentPeriodStart } from "./recent-period";

describe("dashboard recent periods", () => {
  it("includes today without silently adding an eighth or thirty-first day", () => {
    expect(recentPeriodStart("2026-11-10", 7, "America/Recife")).toBe(
      "2026-11-04T03:00:00.000Z",
    );
    expect(recentPeriodStart("2026-11-10", 30, "America/Recife")).toBe(
      "2026-10-12T03:00:00.000Z",
    );
  });
  it("uses civil days across daylight saving and extreme timezone offsets", () => {
    expect(recentPeriodStart("2026-11-02", 7, "America/New_York")).toBe(
      "2026-10-27T04:00:00.000Z",
    );
    expect(recentPeriodStart("2026-11-10", 7, "Pacific/Kiritimati")).toBe(
      "2026-11-03T10:00:00.000Z",
    );
  });
});
