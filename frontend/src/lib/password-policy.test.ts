import { describe, expect, it } from "vitest";

import { passwordPolicyIssues } from "./password-policy";

describe("password policy", () => {
  it("reports every requirement that is not met", () => {
    expect(passwordPolicyIssues("abcdefghijkl")).toEqual([
      "Uma letra maiúscula",
      "Um número",
      "Um caractere especial (por exemplo: !, @, #)",
    ]);
  });

  it("accepts passwords meeting the full policy", () => {
    expect(passwordPolicyIssues("OrbitSeguro2026!")).toEqual([]);
  });
});
