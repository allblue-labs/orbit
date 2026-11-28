import { describe, expect, it } from "vitest";

import { portalPathAllowed, portalTokenExpired } from "./portal-session";

const token = (payload: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.y`;

describe("BFF do portal do cliente", () => {
  it("só deixa passar o que é do cliente", () => {
    expect(portalPathAllowed("/portal/me/summary", "GET")).toBe(true);
    expect(portalPathAllowed("/portal/me/service-requests", "POST")).toBe(true);
    expect(portalPathAllowed("/portal/me/biometrics", "GET")).toBe(true);
    expect(portalPathAllowed("/portal/me/biometrics/devices", "POST")).toBe(
      false,
    );
    expect(
      portalPathAllowed("/portal/me/biometrics/devices/options", "POST"),
    ).toBe(false);
    expect(
      portalPathAllowed(
        "/portal/auth/biometrics/devices/authentication",
        "POST",
      ),
    ).toBe(false);
    expect(portalPathAllowed("/portal/auth/password", "PATCH")).toBe(true);
    /* Login, renovação e saída têm rotas próprias, que cuidam dos cookies. */
    expect(portalPathAllowed("/portal/auth/login", "POST")).toBe(false);
    expect(portalPathAllowed("/portal/auth/refresh", "POST")).toBe(false);
    /* Nada fora do portal, nem por caminho torto. */
    expect(portalPathAllowed("/portal/meu", "GET")).toBe(false);
    expect(portalPathAllowed("/portal/me/../../customers", "GET")).toBe(false);
  });

  it("token de outra natureza conta como ausente", () => {
    const agora = Math.floor(Date.now() / 1000);
    expect(
      portalTokenExpired(
        token({ actorType: "CUSTOMER_PORTAL", exp: agora + 600 }),
      ),
    ).toBe(false);
    expect(
      portalTokenExpired(
        token({ actorType: "CUSTOMER_PORTAL", exp: agora + 5 }),
      ),
    ).toBe(true);
    /* Um token da equipe nunca vira sessão de cliente. */
    expect(portalTokenExpired(token({ exp: agora + 600 }))).toBe(true);
    expect(portalTokenExpired(undefined)).toBe(true);
    expect(portalTokenExpired("lixo")).toBe(true);
  });
});
