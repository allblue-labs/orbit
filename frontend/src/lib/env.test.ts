import { afterEach, describe, expect, it, vi } from "vitest";

import { serverEnv } from "./env";

describe("server release environment", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when the production backend origin is absent", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ORBIT_API_URL", "");
    expect(() => serverEnv.backendOrigin).toThrow(/ORBIT_API_URL is required/);
  });

  it("accepts the explicit private Compose API origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ORBIT_API_URL", "http://api:5001/api/v1/");
    expect(serverEnv.backendOrigin).toBe("http://api:5001/api/v1");
  });

  it("rejects credentials embedded in a backend URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ORBIT_API_URL", "https://user:secret@api.example.test/api/v1");
    expect(() => serverEnv.backendOrigin).toThrow(/absolute HTTP/);
  });

  it("requires secure cookies in production unless local smoke opts in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_COOKIE_SECURE", "false");
    vi.stubEnv("ALLOW_INSECURE_LOCAL_COOKIES", "false");
    expect(() => serverEnv.authCookieSecure).toThrow(
      /ALLOW_INSECURE_LOCAL_COOKIES/,
    );
  });

  it("requires an exact public frontend origin in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRONTEND_ORIGIN", "");
    expect(() => serverEnv.frontendOrigins).toThrow(
      /FRONTEND_ORIGIN is required/,
    );

    vi.stubEnv("FRONTEND_ORIGIN", "https://app.example.test/path");
    expect(() => serverEnv.frontendOrigins).toThrow(/exact HTTP/);
  });

  it("permits HTTP only for the explicit local validation runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRONTEND_ORIGIN", "http://127.0.0.1:3000");
    vi.stubEnv("ALLOW_INSECURE_LOCAL_COOKIES", "true");
    expect(serverEnv.frontendOrigins).toEqual(["http://127.0.0.1:3000"]);
  });

  it("accepts the comma-separated list the backend already parses", () => {
    /// A mesma variável alimenta o CORS do NestJS, que sempre a tratou como
    /// lista. Lida como origem única aqui, `new URL()` lançava e derrubava
    /// todo pedido ao BFF — o bug que impedia o login em localhost.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_INSECURE_LOCAL_COOKIES", "true");
    vi.stubEnv(
      "FRONTEND_ORIGIN",
      "http://localhost:3000, https://orbit.example.test",
    );
    expect(serverEnv.frontendOrigins).toEqual([
      "http://localhost:3000",
      "https://orbit.example.test",
    ]);
  });

  it("rejects a wildcard anywhere in the list", () => {
    /// Curinga com cookie HttpOnly é qualquer site do mundo agindo como a
    /// pessoa autenticada.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FRONTEND_ORIGIN", "https://app.example.test,*");
    expect(() => serverEnv.frontendOrigins).toThrow(/wildcard/);
  });

  it("validates every entry, not just the first", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "FRONTEND_ORIGIN",
      "https://app.example.test,https://outro.example.test/path",
    );
    expect(() => serverEnv.frontendOrigins).toThrow(/exact HTTP/);
  });
});
