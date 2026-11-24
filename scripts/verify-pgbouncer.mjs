import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  run,
  withIntegrationEnvironment,
} from "./lib/integration-environment.mjs";

const image =
  process.env.ORBIT_TEST_PGBOUNCER_IMAGE || "orbit-pgbouncer:rls-test";
await withIntegrationEnvironment(
  async ({ env, container, options }) => {
    const name = `orbit-pool-e2e-${randomBytes(6).toString("hex")}`;
    const docker = (...args) =>
      execFileSync("docker", args, {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    docker("image", "inspect", image);
    docker("network", "create", name);
    let started = false;
    try {
      docker("network", "connect", "--alias", "postgres", name, container);
      await run(
        "docker",
        [
          "run",
          "-d",
          "--rm",
          "--name",
          name,
          "--network",
          name,
          "--publish",
          "127.0.0.1::6432",
          "--read-only",
          "--tmpfs",
          "/run/pgbouncer:rw,noexec,nosuid,size=1048576,uid=1001,gid=1001,mode=0700",
          "--env",
          "POSTGRES_DB",
          "--env",
          "APP_DATABASE_PASSWORD",
          "--env",
          "WORKER_DATABASE_PASSWORD",
          "--env",
          "DOCUMENTS_DATABASE_PASSWORD",
          "--env",
          "PGBOUNCER_DEFAULT_POOL_SIZE=4",
          "--env",
          "PGBOUNCER_RESERVE_POOL_SIZE=0",
          "--env",
          "PGBOUNCER_MAX_DB_CONNECTIONS=10",
          image,
        ],
        { env },
      );
      started = true;
      for (let i = 0; ; i++) {
        try {
          docker("exec", name, "/usr/local/bin/orbit-pgbouncer", "healthcheck");
          break;
        } catch {
          if (i === 30)
            throw new Error("Disposable PgBouncer failed its health check");
          await delay(500);
        }
      }
      const port = docker("port", name, "6432/tcp").trim().split(":").at(-1);
      const url = (user, password) =>
        `postgresql://${user}:${password}@127.0.0.1:${port}/${env.POSTGRES_DB}?pgbouncer=true`;
      const suites = process.argv.slice(2);
      await run(
        "npm",
        [
          "run",
          "test:e2e:jest",
          "--",
          "--runInBand",
          "--watchman=false",
          ...(suites.length
            ? suites
            : ["pgbouncer-rls.e2e-spec.ts", "pgbouncer-queue.e2e-spec.ts"]),
        ],
        {
          ...options,
          env: {
            ...env,
            ORBIT_PGBOUNCER_E2E: name,
            APP_DATABASE_URL: url("orbit_app", env.APP_DATABASE_PASSWORD),
            ORBIT_PG_WORKER_URL: url(
              "orbit_worker",
              env.WORKER_DATABASE_PASSWORD,
            ),
            ORBIT_PG_DOCUMENTS_URL: url(
              "orbit_documents",
              env.DOCUMENTS_DATABASE_PASSWORD,
            ),
          },
        },
      );
    } finally {
      if (started) docker("stop", "--timeout", "2", name);
      docker("network", "disconnect", name, container);
      docker("network", "rm", name);
    }
  },
  { postgresTmpfs: true, separateWorkers: true },
);
