import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.ORBIT_DEPENDENCY_WEB_URL ?? "http://127.0.0.1:17202";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) {
  throw new Error(
    "The dependency smoke must target an isolated loopback server.",
  );
}

/** Standalone release smoke with a synthetic upstream; never uses the real tenant setup. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["dependencies.smoke.spec.ts", "signup-legal-retention.spec.ts"],
  grep: /dependências|aceite obrigatório/,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  outputDir: "test-results/dependencies",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
