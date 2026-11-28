import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  backendFetch: vi.fn(),
  resolveAccess: vi.fn(),
  persistSession: vi.fn(),
  endSession: vi.fn(),
  refreshTokens: vi.fn(),
  readStoredTokens: vi.fn(),
}));
vi.mock("@/server/backend-client", () => ({
  backendFetch: mocks.backendFetch,
}));
vi.mock("@/server/auth/session", () => mocks);
vi.mock("@/lib/env", () => ({
  serverEnv: { frontendOrigins: ["https://orbit.test"] },
  DEFAULT_LOCALE: "pt-BR",
  DEFAULT_TIMEZONE: "America/Recife",
}));
import { proxyToBackend } from "./proxy";
const headers = {
  origin: "https://orbit.test",
  "sec-fetch-site": "same-origin",
  "content-type": "application/pdf",
};
const pair = {
  accessToken: "next",
  refreshToken: "next-refresh",
  tokenType: "Bearer",
  expiresIn: 900,
  mustChangePassword: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAccess.mockResolvedValue({
    accessToken: "old",
    claims: { organizationId: "org" },
    rotated: null,
    expired: false,
  });
  mocks.backendFetch.mockResolvedValue(new Response("ok", { status: 200 }));
});
describe("BFF upload bounds and session preservation", () => {
  it("does not forward declared excess and persists tokens already rotated before reading the body", async () => {
    mocks.resolveAccess.mockResolvedValue({
      accessToken: "next",
      claims: { organizationId: "org" },
      rotated: pair,
      expired: false,
    });
    const req = new NextRequest(
      "https://orbit.test/api/orbit/storage/objects",
      {
        method: "PUT",
        headers: { ...headers, "content-length": "20971521" },
        body: "x",
      },
    );
    const response = await proxyToBackend(req, {
      params: Promise.resolve({ path: ["storage", "objects"] }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("connection")).toBe("close");
    expect(mocks.backendFetch).not.toHaveBeenCalled();
    expect(mocks.persistSession).toHaveBeenCalledWith(expect.anything(), pair);
    expect(mocks.endSession).not.toHaveBeenCalled();
  });
  it("replays the exact bounded body after a 401 and forwards browser cancellation", async () => {
    mocks.backendFetch
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(new Response("ok"));
    mocks.readStoredTokens.mockResolvedValue({ refreshToken: "old-refresh" });
    mocks.refreshTokens.mockResolvedValue(pair);
    const req = new NextRequest(
      "https://orbit.test/api/orbit/storage/objects",
      { method: "PUT", headers, body: "%PDF-test" },
    );
    const response = await proxyToBackend(req, {
      params: Promise.resolve({ path: ["storage", "objects"] }),
    });
    expect(response.status).toBe(200);
    expect(mocks.backendFetch).toHaveBeenCalledTimes(2);
    const first = mocks.backendFetch.mock.calls[0]![0] as {
      body: ArrayBuffer;
      signal: AbortSignal;
      retries: number;
      timeoutMs: number;
    };
    const second = mocks.backendFetch.mock.calls[1]![0] as {
      body: ArrayBuffer;
      accessToken: string;
    };
    expect(second.body).toBe(first.body);
    expect(new TextDecoder().decode(first.body)).toBe("%PDF-test");
    expect(first.signal).toBe(req.signal);
    expect(first.retries).toBe(0);
    expect(first.timeoutMs).toBe(60_000);
    expect(second.accessToken).toBe("next");
  });
});
