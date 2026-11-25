import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  run,
  withIntegrationEnvironment,
} from "./lib/integration-environment.mjs";

await withIntegrationEnvironment(
  async ({ env, options }) => {
    const name = `orbit-hotpath-e2e-${randomBytes(6).toString("hex")}`;
    const password = randomBytes(32).toString("hex");
    const docker = (...args) =>
      execFileSync("docker", args, { env, encoding: "utf8" });
    await run(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--memory",
        "128m",
        "--tmpfs",
        "/data",
        "--publish",
        "127.0.0.1::6379",
        "--env",
        "REDIS_HOTPATH_PASSWORD",
        "redis:8.4-alpine@sha256:ff72f74e4f471df79ed920aa8bbc35efe72ff8a1f8acdc50aad5dbb9b14a4034",
        "sh",
        "-ec",
        "printf '%s\\n' 'save \"\"' 'appendonly no' \"requirepass $REDIS_HOTPATH_PASSWORD\" | exec redis-server -",
      ],
      { env: { ...env, REDIS_HOTPATH_PASSWORD: password } },
    );
    try {
      await run(
        "npm",
        [
          "run",
          "test:e2e:jest",
          "--",
          "--runInBand",
          "--watchman=false",
          "hotpath.e2e-spec.ts",
          "auth-rate-limit.e2e-spec.ts",
        ],
        {
          ...options,
          env: {
            ...env,
            ORBIT_HOTPATH_E2E_REDIS: name,
            REDIS_HOTPATH_HOST: "127.0.0.1",
            REDIS_HOTPATH_PORT: docker("port", name, "6379/tcp")
              .trim()
              .split(":")
              .at(-1),
            REDIS_HOTPATH_PASSWORD: password,
          },
        },
      );
    } finally {
      const state = docker(
        "ps",
        "-a",
        "--filter",
        `name=^${name}$`,
        "--format",
        "{{.State}}",
      ).trim();
      if (state === "paused") docker("unpause", name);
      if (state) docker("stop", "--timeout", "2", name);
    }
  },
  { postgresTmpfs: true },
);
