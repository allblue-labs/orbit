import { describe, expect, it } from "vitest";

import { previewSandbox } from "./preview-frame";

describe("quadro de pré-visualização", () => {
  it("PDF sem sandbox — o Chrome bloqueia o leitor de PDF em iframe isolado", () => {
    expect(previewSandbox("PDF")).toBeUndefined();
    expect(previewSandbox("application/pdf")).toBeUndefined();
  });

  it("HTML e formatos desconhecidos continuam isolados, sem scripts", () => {
    expect(previewSandbox("HTML")).toBe("");
    expect(previewSandbox("JSON")).toBe("");
    expect(previewSandbox(undefined)).toBe("");
  });
});
