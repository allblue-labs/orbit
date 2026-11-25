import { afterEach, describe, expect, it, vi } from "vitest";
import { backendFetch } from "./backend-client";
import {
  clientOriginHeaders,
  trustedOrigin,
  withClientOrigin,
} from "./trusted-client-origin";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("origem do ingress no BFF", () => {
  it("o cliente HTTP remove cabeçalhos de origem do chamador antes de injetar os verificados", async () => {
    vi.stubEnv("TRUSTED_PROXY_SECRET", "a".repeat(64));
    vi.stubEnv("ORBIT_API_URL", "http://backend.test/api/v1");
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await withClientOrigin(
      new Request("https://orbit.test", {
        headers: {
          "x-orbit-client-ip": "192.0.2.1",
          "x-orbit-proxy-secret": "a".repeat(64),
        },
      }),
      () =>
        backendFetch({
          path: "/identity/login",
          method: "POST",
          headers: {
            "X-Orbit-Client-IP": "203.0.113.99",
            "X-Orbit-Proxy-Secret": "forged",
            "X-Forwarded-For": "forged",
          },
        }),
    );
    const headers = new Headers(fetch.mock.calls[0]![1].headers);
    expect(headers.get("x-orbit-client-ip")).toBe("192.0.2.1");
    expect(headers.get("x-orbit-proxy-secret")).toBe("a".repeat(64));
    expect(headers.has("x-forwarded-for")).toBe(false);
  });
  it("ignora cabeçalhos forjados e aceita somente um IP com a credencial interna", () => {
    vi.stubEnv("TRUSTED_PROXY_SECRET", "a".repeat(64));
    const request = (secret: string) =>
      new Request("https://orbit.test", {
        headers: {
          "x-orbit-client-ip": "192.0.2.20",
          "x-orbit-proxy-secret": secret,
          "x-forwarded-for": "203.0.113.99",
        },
      });
    expect(trustedOrigin(request("forged"))).toBeNull();
    expect(trustedOrigin(request("a".repeat(64)))).toBe("192.0.2.20");
    expect(withClientOrigin(request("forged"), clientOriginHeaders)).toEqual(
      {},
    );
    expect(
      withClientOrigin(request("a".repeat(64)), clientOriginHeaders),
    ).toMatchObject({ "x-orbit-client-ip": "192.0.2.20" });
  });
  it("mantém origens isoladas em chamadas concorrentes e não inventa origem fora do request", async () => {
    vi.stubEnv("TRUSTED_PROXY_SECRET", "a".repeat(64));
    const results = await Promise.all(
      ["192.0.2.1", "192.0.2.2"].map((ip) =>
        withClientOrigin(
          new Request("https://orbit.test", {
            headers: {
              "x-orbit-client-ip": ip,
              "x-orbit-proxy-secret": "a".repeat(64),
            },
          }),
          async () => {
            await Promise.resolve();
            return clientOriginHeaders();
          },
        ),
      ),
    );
    expect(results.map((result) => result["x-orbit-client-ip"])).toEqual([
      "192.0.2.1",
      "192.0.2.2",
    ]);
    expect(clientOriginHeaders()).toEqual({});
  });
});
