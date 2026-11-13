import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenPair } from "@/types/session";
import { ApiError } from "@/lib/api-error";

const { backendJson } = vi.hoisted(() => ({ backendJson: vi.fn() }));
vi.mock("@/server/backend-client", () => ({
  backendJson,
  jsonBody: (value: unknown) => JSON.stringify(value),
}));
import { refreshTokens } from "./refresh";

const pair: TokenPair = {
  accessToken: "access-next",
  refreshToken: "refresh-next",
  tokenType: "Bearer",
  expiresIn: 900,
  mustChangePassword: false,
};
beforeEach(() => backendJson.mockReset());
describe("renovação coordenada pela API", () => {
  it.each([429, 503])(
    "preserva falha temporária %s para o chamador, sem sinalizar sessão expirada",
    async (status) => {
      const error = new ApiError({
        kind: "http",
        status,
        message: "Aguarde",
        details: { retryAfterSeconds: 17 },
      });
      backendJson.mockRejectedValueOnce(error).mockResolvedValueOnce(pair);
      await expect(refreshTokens(`temporary-${status}`)).rejects.toBe(error);
      expect(await refreshTokens(`temporary-${status}`)).toEqual(pair);
    },
  );
  it("compartilha somente a chamada em andamento", async () => {
    let release!: (value: TokenPair) => void;
    backendJson.mockReturnValue(
      new Promise<TokenPair>((resolve) => {
        release = resolve;
      }),
    );
    const results = [
      refreshTokens("old"),
      refreshTokens("old"),
      refreshTokens("old"),
    ];
    expect(backendJson).toHaveBeenCalledTimes(1);
    release(pair);
    expect(await Promise.all(results)).toEqual([pair, pair, pair]);
  });
  it("reconfere a API após concluir e não mascara uma revogação com cache local", async () => {
    backendJson
      .mockResolvedValueOnce(pair)
      .mockRejectedValueOnce(
        new ApiError({ kind: "http", status: 401, message: "revoked" }),
      );
    expect(await refreshTokens("revocable")).toEqual(pair);
    expect(await refreshTokens("revocable")).toBeNull();
    expect(backendJson).toHaveBeenCalledTimes(2);
    expect(backendJson).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/identity/refresh",
        retries: 0,
        body: JSON.stringify({ refreshToken: "revocable" }),
      }),
    );
  });
});
