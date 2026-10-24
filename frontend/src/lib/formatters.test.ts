import { describe, expect, it } from "vitest";
import { createDateFormatters } from "./formatters";

describe("dates in the account timezone", () => {
  const recife = createDateFormatters("America/Recife");
  const branco = createDateFormatters("America/Rio_Branco");

  it("converts an instant across midnight without changing it", () => {
    const instant = "2026-10-24T03:30:00Z";
    expect(recife.formatDateTime(instant)).toContain("24/10");
    expect(recife.formatTime(instant)).toBe("00:30");
    expect(branco.formatDateTime(instant)).toContain("23/10");
    expect(branco.formatTime(instant)).toBe("22:30");
    expect(branco.formatDate(instant)).toBe("23/10/2026");
    expect(branco.formatAxisDate(instant)).toBe("23/10");
  });

  it("preserves civil dates in every timezone", () => {
    for (const timeZone of [
      "America/Recife",
      "America/Rio_Branco",
      "Pacific/Kiritimati",
    ]) {
      expect(createDateFormatters(timeZone).formatDate("2026-10-24")).toBe(
        "24/10/2026",
      );
    }
  });

  it("does not leak a preference between concurrent consumers", () => {
    const instant = "2026-10-24T03:30:00Z";
    expect(branco.formatTime(instant)).toBe("22:30");
    expect(recife.formatTime(instant)).toBe("00:30");
    expect(branco.formatTime(instant)).toBe("22:30");
  });

  it("retains empty and invalid date fallbacks", () => {
    expect(branco.formatDateTime(null)).toBe("—");
    expect(branco.formatDate("invalid")).toBe("—");
    expect(branco.formatAxisDate("invalid")).toBe("invalid");
  });
});
