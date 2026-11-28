import { describe, expect, it } from "vitest";

import { segmentLabel } from "./segment-label";

describe("segmento", () => {
  it("traduz os códigos conhecidos e deixa o resto legível", () => {
    expect(segmentLabel("HVAC_R")).toBe("Refrigeração e climatização");
    expect(segmentLabel("HVAC")).toBe("Climatização");
    expect(segmentLabel("ENERGIA_SOLAR")).toBe("Energia solar");
    expect(segmentLabel("Elétrica predial")).toBe("Elétrica predial");
  });
});
