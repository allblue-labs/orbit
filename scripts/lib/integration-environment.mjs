import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const backend = resolve(root, "backend");

const runningCommands = new Set();
export function cancelRunningCommands() {
  for (const child of runningCommands) {
    try {
      process.kill(
        process.platform === "win32" ? child.pid : -child.pid,
        "SIGTERM",
      );
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      detached: process.platform !== "win32",
      ...options,
    });
    runningCommands.add(child);
    child.once("error", (error) => {
      runningCommands.delete(child);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      runningCommands.delete(child);
      if (code === 0) resolve();
      else
        reject(
          new Error(`${command} ${args[0] ?? ""} failed (${signal ?? code})`),
        );
    });
  });
}

/** Every database is newly created here. Host DATABASE_URL is never consumed. */
export async function withIntegrationEnvironment(work) {
  const directory = await mkdtemp(join(tmpdir(), "orbit-integration-"));
  const compiled = join(directory, "compiled");
  const suffix = randomBytes(8).toString("hex");
  const container = `orbit-e2e-${suffix}`;
  const database = `orbit_e2e_${suffix}`;
  // Keep OS/toolchain settings, but do not inherit app or cloud credentials.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|HOME|TMPDIR|TEMP|TMP|SystemRoot|CI|GITHUB_ACTIONS|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG|FLUTTER_ROOT|PUB_CACHE|JAVA_HOME|ANDROID_HOME|ANDROID_SDK_ROOT|ORBIT_FLUTTER_BIN|LANG|LC_ALL|TZ|TERM|NO_COLOR|FORCE_COLOR|npm_.*)$/.test(
        key,
      ),
    ),
  );
  // Existing dotenv loaders must not fill missing values from a developer .env.
  // Only the names are read; values are never parsed, used or printed.
  for (const file of [
    ...["", "backend/", "frontend/"].flatMap((prefix) =>
      [
        ".env.example",
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
        ".env.test",
        ".env.test.local",
        ".env.production",
        ".env.production.local",
      ].map((name) => `${prefix}${name}`),
    ),
  ]) {
    try {
      for (const match of (
        await readFile(resolve(root, file), "utf8")
      ).matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm))
        env[match[1]] = "";
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  Object.assign(env, {
    NODE_ENV: "test",
    TZ: "UTC",
    TMPDIR: directory,
    POSTGRES_USER: "orbit_test_admin",
    POSTGRES_DB: database,
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    APP_DATABASE_USER: "orbit_app",
    APP_DATABASE_PASSWORD: randomBytes(32).toString("hex"),
    DATABASE_ENFORCE_RESTRICTED_ROLE: "true",
    JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    TRUSTED_PROXY_SECRET: randomBytes(32).toString("hex"),
    AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString("hex"),
    // Broad suites share one synthetic origin. Focused rate-limit tests use
    // their own small limits; the middleware is never disabled by NODE_ENV.
    AUTH_RATE_LIMIT_MAX: "100000",
    AUTH_RATE_LIMIT_ORIGIN_MAX: "100000",
    AUTH_RATE_LIMIT_WINDOW_MS: "60000",
    TRIAL_FINGERPRINT_SECRET: randomBytes(32).toString("hex"),
    STORAGE_PROVIDER: "LOCAL",
    STORAGE_LOCAL_DIR: join(directory, "objects"),
    STORAGE_BUCKET: "orbit-artifacts",
    STORAGE_PUBLIC_API_URL: "http://127.0.0.1:6001/api/v1",
    IDENTITY_PUBLIC_WEB_URL: "http://127.0.0.1:3000",
    FRONTEND_ORIGIN: "http://127.0.0.1:3000",
    PUSH_PROVIDER: "disabled",
    STRIPE_ENABLED: "false",
    JOBS_WORKER_ENABLED: "false",
    BILLING_EVENTS_WORKER_ENABLED: "false",
    ORBIT_E2E_DATABASE: database,
    ORBIT_E2E_DIRECTORY: directory,
  });
  let started = false;
  process.once("SIGINT", cancelRunningCommands);
  process.once("SIGTERM", cancelRunningCommands);
  try {
    await run(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        container,
        "--memory",
        "1g",
        "--cpus",
        "2",
        "--publish",
        "127.0.0.1::5432",
        "--env",
        "POSTGRES_USER",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "POSTGRES_DB",
        "postgres:17.11-alpine3.24@sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0",
      ],
      { env },
    );
    started = true;
    const port = execFileSync("docker", ["port", container, "5432/tcp"], {
      env,
      encoding: "utf8",
    })
      .trim()
      .split(":")
      .at(-1);
    env.DATABASE_URL = `postgresql://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@127.0.0.1:${port}/${database}?schema=public`;
    env.APP_DATABASE_URL = `postgresql://${env.APP_DATABASE_USER}:${env.APP_DATABASE_PASSWORD}@127.0.0.1:${port}/${database}?schema=public`;
    for (let attempt = 0; ; attempt++) {
      try {
        execFileSync(
          "docker",
          [
            "exec",
            container,
            "pg_isready",
            "-U",
            env.POSTGRES_USER,
            "-d",
            database,
          ],
          { env, stdio: "ignore" },
        );
        break;
      } catch {
        if (attempt >= 60)
          throw new Error("Disposable PostgreSQL did not become ready");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    const options = { cwd: backend, env };
    try {
      await access(resolve(backend, "node_modules/.prisma/client/default.js"));
    } catch {
      await run("npm", ["exec", "--", "prisma", "generate"], options);
    }
    // Concurrent suites never delete or rewrite another suite's running build.
    await run(
      "npm",
      [
        "exec",
        "--",
        "tsc",
        "--project",
        "tsconfig.build.json",
        "--outDir",
        compiled,
        "--incremental",
        "false",
      ],
      options,
    );
    await symlink(
      resolve(backend, "node_modules"),
      resolve(compiled, "node_modules"),
      "dir",
    );
    const script = (name) => resolve(compiled, "src/scripts", `${name}.js`);
    await run(process.execPath, [script("provision-database-roles")], {
      ...options,
      env: { ...env, DATABASE_ROLE_BOOTSTRAP_ONLY: "true" },
    });
    await run("npm", ["exec", "--", "prisma", "migrate", "deploy"], options);
    await run(process.execPath, [script("provision-database-roles")], options);
    await run(process.execPath, [script("seed-plan-catalog")], options);
    await run(process.execPath, [script("seed-artifact-templates")], options);
    await work({ env, directory, compiled, options });
  } finally {
    process.off("SIGINT", cancelRunningCommands);
    process.off("SIGTERM", cancelRunningCommands);
    if (started)
      await run("docker", ["stop", "--timeout", "10", container], { env });
    await rm(directory, { recursive: true, force: true });
  }
}
