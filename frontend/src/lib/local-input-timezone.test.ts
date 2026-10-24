import { describe, expect, it } from "vitest";
import { instantFromLocalInput } from "./scheduling/timezone";
import {
  completePayload,
  emptyDraft,
  isFuture,
} from "@/components/pmoc/attendance/attendance.model";
import { today } from "@/components/financial/receipts/receipt-wizard.model";

describe("local inputs in the account timezone", () => {
  it("converts wall time without depending on the browser zone", () => {
    expect(
      instantFromLocalInput(
        "2026-10-24T09:00",
        "America/Rio_Branco",
      ).toISOString(),
    ).toBe("2026-10-24T14:00:00.000Z");
    expect(
      instantFromLocalInput("2026-10-24T09:00", "America/Recife").toISOString(),
    ).toBe("2026-10-24T12:00:00.000Z");
  });

  it("uses the same timezone for PMOC validation and submission", () => {
    const draft = {
      ...emptyDraft("technician"),
      performedAt: "2026-10-24T09:00",
    };
    expect(completePayload(draft, "America/Rio_Branco").performedAt).toBe(
      "2026-10-24T14:00:00.000Z",
    );
    const now = Date.parse("2026-10-24T13:00:00Z");
    expect(isFuture(draft.performedAt, now, "America/Rio_Branco")).toBe(true);
    expect(isFuture(draft.performedAt, now, "America/Recife")).toBe(false);
  });

  it("defaults receipt dates to today in the selected timezone", () => {
    const now = new Date("2026-10-24T03:30:00Z");
    expect(today(now, "America/Rio_Branco")).toBe("2026-10-23");
    expect(today(now, "America/Recife")).toBe("2026-10-24");
  });
});
