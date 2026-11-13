import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { bff } from "./provision";
import { login } from "./support";

// Independent RFC 6238 fixture, using the enrollment's base32 secret.
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const bytes = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, "0");
}

test("refresh paralelo preserva cookies canônicos e logout invalida o token anterior", async ({
  page,
}) => {
  await login(page);
  const old = (await page.context().cookies()).find(
    (cookie) => cookie.name === "orbit_refresh",
  )!;
  const responses = await Promise.all(
    Array.from({ length: 6 }, () => bff(page, "post", "/api/auth/refresh", {})),
  );
  const refreshCookies: string[] = [];
  for (const response of responses) {
    expect(response.status(), await response.text()).toBe(200);
    const cookie = response
      .headersArray()
      .find(
        (header) =>
          header.name.toLowerCase() === "set-cookie" &&
          header.value.startsWith("orbit_refresh="),
      );
    expect(cookie).toBeTruthy();
    refreshCookies.push(cookie!.value.split(";")[0]!);
    expect(await response.json()).toMatchObject({
      data: { authenticated: true },
    });
    expect(await response.text()).not.toContain(old.value);
  }
  expect(new Set(refreshCookies).size).toBe(1);
  expect(refreshCookies[0]).not.toBe(`orbit_refresh=${old.value}`);
  expect((await bff(page, "post", "/api/auth/logout", {})).status()).toBe(200);
  const replay = await bff(
    page,
    "post",
    "/api/auth/refresh",
    {},
    { Cookie: `orbit_refresh=${old.value}` },
  );
  expect(replay.status()).toBe(401);
});

test("login aceita os 16 caracteres de um código de recuperação emitido pelo MFA", async ({
  page,
}) => {
  await login(page);
  const access = (await page.context().cookies()).find(
    (cookie) => cookie.name === "orbit_access",
  )!.value;
  const enrolled = await bff(
    page,
    "post",
    "/api/orbit/identity/me/mfa/enrollment",
    {},
  );
  expect(enrolled.status(), await enrolled.text()).toBe(201);
  const enrollment = (await enrolled.json()).data as {
    factorId: string;
    secret: string;
  };
  try {
    const enabled = await bff(
      page,
      "post",
      "/api/orbit/identity/me/mfa/enable",
      {
        factorId: enrollment.factorId,
        code: totp(enrollment.secret),
      },
    );
    expect(enabled.status(), await enabled.text()).toBe(201);
    const code = (await enabled.json()).data.recoveryCodes[0] as string;
    expect(code).toHaveLength(16);
    await page.context().clearCookies();
    await page.goto("/login");
    await page.locator("#email").fill(process.env.ORBIT_OWNER_EMAIL!);
    await page.locator("#password").fill(process.env.ORBIT_OWNER_PASSWORD!);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    const input = page.locator("#mfaCode");
    await expect(input).toBeVisible();
    await input.fill(code);
    await expect(input).toHaveValue(code);
    await expect(input).toHaveAttribute("inputmode", "text");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/);
    expect((await bff(page, "get", "/api/auth/session")).ok()).toBe(true);
  } finally {
    // Fixture cleanup uses the still-valid pre-enrollment session; it is not
    // logged out when clearing browser cookies and belongs to this test DB.
    const cleared = await page.request.delete(
      `${process.env.ORBIT_API_URL}/identity/me/mfa`,
      {
        headers: { authorization: `Bearer ${access}` },
      },
    );
    expect(cleared.status(), await cleared.text()).toBe(204);
  }
});
