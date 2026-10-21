import { describe, expect, it } from "vitest";
import {
  MAX_OPERATION_AMOUNT,
  operationInstant,
  operationStepIssues,
  parseOperationAmount,
  type OperationWizardFields,
} from "./operation-wizard.model";

const valid: OperationWizardFields = {
  businessUnitId: "unit",
  title: "Visita técnica",
  code: "OS-001",
  kind: "MAINTENANCE",
  startLocal: "",
  endLocal: "",
  manualAmount: "",
};
const zone = "America/Recife";

describe("operation wizard", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["0", 0],
    ["0,00", 0],
    ["1250,50", 1250.5],
    ["1.250,50", 1250.5],
    ["1250.50", 1250.5],
    ["1.250", 1250],
  ])("parses %s without confusing blank and zero", (input, result) => {
    expect(parseOperationAmount(input as string)).toBe(result);
  });
  it.each([
    "-1",
    "1,001",
    "1.2345",
    "abc",
    "Infinity",
    "1.2,34",
    "1,2,3",
    "R$ 10",
  ])("rejects invalid money %s", (value) => {
    expect(
      operationStepIssues(3, { ...valid, manualAmount: value }, zone),
    ).not.toEqual([]);
  });
  it("checks the database precision limit", () => {
    expect(
      operationStepIssues(
        3,
        { ...valid, manualAmount: String(MAX_OPERATION_AMOUNT) },
        zone,
      ),
    ).toEqual([]);
    expect(
      operationStepIssues(3, { ...valid, manualAmount: "1000000000000" }, zone),
    ).not.toEqual([]);
  });
  it("converts the chosen local timezone rather than the browser timezone", () => {
    expect(operationInstant("2026-10-21T09:00", zone)).toBe(
      "2026-10-21T12:00:00.000Z",
    );
  });
  it("accepts unscheduled operations and a start without an end", () => {
    expect(operationStepIssues(4, valid, zone)).toEqual([]);
    expect(
      operationStepIssues(
        2,
        { ...valid, startLocal: "2026-10-21T09:00" },
        zone,
      ),
    ).toEqual([]);
  });
  it("rejects an end without a start, or at/before its start", () => {
    expect(
      operationStepIssues(2, { ...valid, endLocal: "2026-10-21T08:00" }, zone),
    ).not.toEqual([]);
    for (const endLocal of ["2026-10-21T08:00", "2026-10-21T09:00"])
      expect(
        operationStepIssues(
          2,
          { ...valid, startLocal: "2026-10-21T09:00", endLocal },
          zone,
        ),
      ).not.toEqual([]);
  });
  it("validates each category and rechecks all required fields before confirmation", () => {
    const draft = {
      ...valid,
      title: "",
      businessUnitId: "",
      manualAmount: "-1",
    };
    expect(operationStepIssues(0, draft, zone)).toEqual([]);
    expect(operationStepIssues(1, draft, zone)).toHaveLength(1);
    expect(operationStepIssues(4, draft, zone)).toHaveLength(3);
  });
});
