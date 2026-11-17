import { describe, expect, it } from "vitest";
import { identityLinkToken, withoutIdentityToken } from "./identity-link-token";
describe("identity links", () => {
  it("prefers the fragment and strips both secret forms while preserving mandatory-login context", () => {
    const url = new URL(
      "https://orbit.example.com/redefinir-senha?motivo=obrigatorio&token=old#token=new",
    );
    expect(identityLinkToken(url)).toBe("new");
    expect(withoutIdentityToken(url).toString()).toBe(
      "https://orbit.example.com/redefinir-senha?motivo=obrigatorio",
    );
  });
  it("keeps legacy links usable and does not turn a fragment into a request query", () => {
    expect(
      identityLinkToken(
        new URL("https://orbit.example.com/convite?token=legacy"),
      ),
    ).toBe("legacy");
    const url = new URL(
      "https://orbit.example.com/convite#token=PRIVATE_OPAQUE",
    );
    expect(url.pathname + url.search).not.toContain("PRIVATE_OPAQUE");
    expect(withoutIdentityToken(url).hash).toBe("");
  });
});
