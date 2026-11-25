import { expect, test } from "@playwright/test";
import { login } from "./support";

test("CSP autoriza scripts da página com um nonce novo por resposta", async ({
  page,
}) => {
  const response = await page.goto("/login");
  const policy = response?.headers()["content-security-policy"];
  const nonce = policy?.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  expect(nonce).toBeTruthy();
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("object-src 'none'");
  expect(policy?.match(/script-src [^;]+/)?.[0]).not.toContain(
    "'unsafe-inline'",
  );
  const scripts = await page
    .locator("script")
    .evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            !element.getAttribute("src") && element.textContent?.trim(),
        )
        .map((element) => (element as HTMLScriptElement).nonce),
    );
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.every((scriptNonce) => scriptNonce === nonce)).toBe(true);

  const second = await page.request.get("/login", {
    headers: { "x-orbit-csp-nonce": "caller-controlled-fixture" },
  });
  const secondPolicy = second.headers()["content-security-policy"];
  expect(secondPolicy).not.toContain(nonce!);
  expect(secondPolicy).not.toContain("caller-controlled-fixture");
  expect(second.headers()["cache-control"]).toContain("no-store");
  await login(page);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
});

test("termos somente aceitam frame da própria origem", async ({ request }) => {
  const response = await request.get("/legal/termos");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'self'",
  );
  expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
});
