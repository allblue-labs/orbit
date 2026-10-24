import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEZONE } from "./env";
import { resolveTimeZone } from "./timezone-preference";

const units = [
  { id: "primary", timezone: "America/Recife", isPrimary: true },
  { id: "branch", timezone: "America/Manaus" },
];

describe("effective timezone preference", () => {
  it("uses the account preference before the active unit and browser", () => {
    expect(
      resolveTimeZone({
        preferredTimeZone: "America/Rio_Branco",
        businessUnits: units,
        businessUnitId: "branch",
        browserTimeZone: "UTC",
      }),
    ).toEqual({
      timeZone: "America/Rio_Branco",
      origin: "preferência da sua conta",
    });
  });

  it("retains the personal preference when switching units", () => {
    for (const businessUnitId of ["primary", "branch", null]) {
      expect(
        resolveTimeZone({
          preferredTimeZone: "America/Noronha",
          businessUnits: units,
          businessUnitId,
        }).timeZone,
      ).toBe("America/Noronha");
    }
  });

  it("falls back to the active unit when no valid preference exists", () => {
    expect(
      resolveTimeZone({
        preferredTimeZone: "invalid",
        businessUnits: units,
        businessUnitId: "branch",
      }).timeZone,
    ).toBe("America/Manaus");
  });

  it("falls back to the primary unit without an active unit", () => {
    expect(resolveTimeZone({ businessUnits: units }).timeZone).toBe(
      "America/Recife",
    );
  });

  it("uses the device only without a personal or unit timezone", () => {
    expect(resolveTimeZone({ browserTimeZone: "UTC" }).timeZone).toBe("UTC");
  });

  it("rejects invalid fallback zones", () => {
    expect(
      resolveTimeZone({
        preferredTimeZone: "invalid",
        browserTimeZone: "invalid",
      }).timeZone,
    ).toBe(DEFAULT_TIMEZONE);
  });
});
