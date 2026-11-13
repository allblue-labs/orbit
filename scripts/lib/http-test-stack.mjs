import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { resolve } from "node:path";
import { access, cp } from "node:fs/promises";
import { browserFixtures } from "./browser-fixtures.mjs";
import {
  root,
  backend,
  run,
  cancelRunningCommands,
} from "./integration-environment.mjs";

async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const value = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return value;
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Test HTTP process exited before readiness");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* bounded readiness probe */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Test HTTP process did not become ready");
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

/** Exercise the traced release output, including its static assets. */
async function standaloneWeb(env, webPort) {
  const frontend = resolve(root, "frontend");
  const staged = resolve(env.ORBIT_E2E_DIRECTORY, "web-release");
  let prepared = true;
  try {
    await access(staged);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    prepared = false;
    // Keep the runtime outside the checkout so missing traced packages cannot
    // accidentally resolve from the developer's node_modules.
    await cp(resolve(frontend, ".next/standalone"), staged, {
      recursive: true,
    });
  }
  const candidates = [staged, resolve(staged, "frontend")];
  let runtime;
  for (const candidate of candidates) {
    try {
      await access(resolve(candidate, "server.js"));
      runtime = candidate;
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!runtime) throw new Error("The Next standalone server was not produced");
  if (!prepared) {
    await cp(resolve(frontend, "public"), resolve(runtime, "public"), {
      recursive: true,
    });
    await cp(
      resolve(frontend, ".next/static"),
      resolve(runtime, ".next/static"),
      { recursive: true },
    );
  }
  return spawn(process.execPath, [resolve(runtime, "server.js")], {
    cwd: runtime,
    env: { ...env, HOSTNAME: "127.0.0.1", PORT: String(webPort) },
    stdio: "inherit",
  });
}

export async function withHttpTestStack(env, { web, compiled }, work) {
  const apiPort = await port();
  const webPort = await port();
  Object.assign(env, {
    JOBS_WORKER_ENABLED: "true",
    JOBS_POLL_INTERVAL_MS: "1000",
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    API_HOST: "127.0.0.1",
    API_PORT: String(apiPort),
    ORBIT_API_URL: `http://127.0.0.1:${apiPort}/api/v1`,
    ORBIT_WEB_URL: `http://127.0.0.1:${webPort}`,
    IDENTITY_PUBLIC_WEB_URL: `http://127.0.0.1:${webPort}`,
    FRONTEND_ORIGIN: `http://127.0.0.1:${webPort}`,
    STORAGE_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}/api/v1`,
    AUTH_COOKIE_SECURE: "false",
    ALLOW_INSECURE_LOCAL_COOKIES: "true",
    OWNER_EMAIL: "owner@orbit.local",
    OWNER_PASSWORD: "OrbitOwner@2026",
    OWNER_FIRST_NAME: "Owner",
    OWNER_LAST_NAME: "E2E",
    OWNER_ORGANIZATION_NAME: "Orbit E2E",
    ORBIT_OWNER_EMAIL: "owner@orbit.local",
    ORBIT_OWNER_PASSWORD: "OrbitOwner@2026",
  });
  await run(
    process.execPath,
    [resolve(compiled, "src/scripts/seed-owner.js")],
    { cwd: backend, env },
  );
  let api;
  let frontend;
  const interrupt = () => {
    cancelRunningCommands();
    api?.kill("SIGTERM");
    frontend?.kill("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    api = spawn(process.execPath, [resolve(compiled, "src/main.js")], {
      cwd: backend,
      env,
      stdio: "inherit",
    });
    api.once("exit", cancelRunningCommands);
    await ready(`${env.ORBIT_API_URL}`, api);
    if (!web) {
      const login = await fetch(`${env.ORBIT_API_URL}/identity/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: env.OWNER_EMAIL,
          password: env.OWNER_PASSWORD,
        }),
      });
      if (!login.ok) throw new Error("Mobile fixture login failed");
      const { data } = await login.json();
      const customer = await fetch(`${env.ORBIT_API_URL}/customers`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${data.accessToken}`,
        },
        body: JSON.stringify({
          type: "COMPANY",
          legalName: "Cliente do smoke mobile",
        }),
      });
      if (!customer.ok)
        throw new Error("Mobile customer fixture could not be created");
    }
    if (web) {
      await browserFixtures(env);
      const cwd = resolve(root, "frontend");
      const webEnv = {
        ...env,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
      };
      await run("npm", ["run", "build"], { cwd, env: webEnv });
      frontend = await standaloneWeb(webEnv, webPort);
      frontend.once("exit", cancelRunningCommands);
      await ready(`${env.ORBIT_WEB_URL}/login`, frontend);
    }
    await work(env);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    api?.off("exit", cancelRunningCommands);
    frontend?.off("exit", cancelRunningCommands);
    await stop(frontend);
    await stop(api);
  }
}

/** Preserve PR-02's isolated upstream checks separately from real tenant E2E. */
export async function withDependencyWeb(env, work) {
  const apiPort = await port();
  const webPort = await port();
  const dependencyEnv = {
    ...env,
    NODE_ENV: "production",
    DEPENDENCY_API_PORT: String(apiPort),
    DEPENDENCY_API_HOST: "127.0.0.1",
    ORBIT_API_URL: `http://127.0.0.1:${apiPort}/api/v1`,
    ORBIT_DEPENDENCY_WEB_URL: `http://127.0.0.1:${webPort}`,
    FRONTEND_ORIGIN: `http://127.0.0.1:${webPort}`,
    AUTH_COOKIE_SECURE: "true",
    ALLOW_INSECURE_LOCAL_COOKIES: "true",
  };
  let fixture;
  let frontend;
  const interrupt = () => {
    cancelRunningCommands();
    fixture?.kill("SIGTERM");
    frontend?.kill("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    fixture = spawn(
      process.execPath,
      [resolve(root, "frontend/e2e/dependencies/upstream.mjs")],
      { cwd: root, env: dependencyEnv, stdio: "inherit" },
    );
    fixture.once("exit", cancelRunningCommands);
    await ready(`${dependencyEnv.ORBIT_API_URL}/plans/catalog`, fixture);
    frontend = await standaloneWeb(dependencyEnv, webPort);
    frontend.once("exit", cancelRunningCommands);
    await ready(`${dependencyEnv.ORBIT_DEPENDENCY_WEB_URL}/login`, frontend);
    await work(dependencyEnv);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    fixture?.off("exit", cancelRunningCommands);
    frontend?.off("exit", cancelRunningCommands);
    await stop(frontend);
    await stop(fixture);
  }
}
