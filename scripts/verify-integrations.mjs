import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  root,
  backend,
  run,
  withIntegrationEnvironment,
} from "./lib/integration-environment.mjs";
import {
  withHttpTestStack,
  withDependencyWeb,
} from "./lib/http-test-stack.mjs";

const [target = "backend", ...args] = process.argv.slice(2);
if (!["backend", "browser", "dependencies", "mobile"].includes(target))
  throw new Error("Choose backend, browser, dependencies or mobile");
await withIntegrationEnvironment(async ({ env, compiled }) => {
  if (target === "backend") {
    await run(
      "npm",
      [
        "run",
        "test:e2e:jest",
        "--",
        "--runInBand",
        "--watchman=false",
        ...args,
      ],
      { cwd: backend, env },
    );
    return;
  }
  if (target === "browser") {
    const email = "platform-mfa@example.test";
    const password = `Orbit#${randomBytes(24).toString("hex")}A1`;
    await run(
      process.execPath,
      [resolve(compiled, "src/scripts/seed-platform-admin.js")],
      {
        cwd: backend,
        env: {
          ...env,
          PLATFORM_ADMIN_EMAIL: email,
          PLATFORM_ADMIN_PASSWORD: password,
          PLATFORM_ADMIN_FIRST_NAME: "Administração",
          PLATFORM_ADMIN_LAST_NAME: "Teste",
        },
      },
    );
    env.ORBIT_E2E_PLATFORM_EMAIL = email;
    env.ORBIT_E2E_PLATFORM_PASSWORD = password;
  }
  await withHttpTestStack(
    env,
    { compiled, web: target === "browser" || target === "dependencies" },
    async () => {
      if (target === "browser" || target === "dependencies") {
        if (target === "browser")
          await run("npm", ["run", "test:browser", "--", ...args], {
            cwd: resolve(root, "frontend"),
            env,
          });
        await withDependencyWeb(env, async (dependencyEnv) => {
          await run("npm", ["run", "test:dependencies"], {
            cwd: resolve(root, "frontend"),
            env: dependencyEnv,
          });
        });
      } else {
        await run(
          env.ORBIT_FLUTTER_BIN || "flutter",
          ["pub", "get", "--enforce-lockfile"],
          { cwd: resolve(root, "mobile"), env },
        );
        await run(
          env.ORBIT_FLUTTER_BIN || "flutter",
          [
            "test",
            "--no-pub",
            "test/smoke",
            "--concurrency=1",
            "--reporter=expanded",
            `--dart-define=ORBIT_API_URL=${env.ORBIT_API_URL}`,
            "--dart-define=ORBIT_SMOKE_ENV=test",
            "--dart-define=ORBIT_REQUIRE_API=true",
            `--dart-define=ORBIT_OWNER_EMAIL=${env.ORBIT_OWNER_EMAIL}`,
            `--dart-define=ORBIT_OWNER_PASSWORD=${env.ORBIT_OWNER_PASSWORD}`,
            ...args,
          ],
          { cwd: resolve(root, "mobile"), env },
        );
      }
    },
  );
});
