import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  withIntegrationEnvironment,
  run,
} from "./lib/integration-environment.mjs";

const image = process.env.ORBIT_TEST_BACKUP_IMAGE ?? "orbit-backup:etapa04";
const postgres =
  "postgres:17.11-alpine3.24@sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0";
const node =
  "node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee";

await withIntegrationEnvironment(
  async ({ directory, container, env }) => {
    const docker = (...args) =>
      execFileSync("docker", args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }).toString();
    const name = "orbit-backup-e2e-" + randomBytes(8).toString("hex");
    const db = name + "-db";
    const s3 = name + "-s3";
    const database = "orbit_restore_" + randomBytes(8).toString("hex");
    const password = randomBytes(32).toString("hex");
    const key = resolve(directory, "key");
    const scratch = resolve(directory, "scratch");
    await mkdir(scratch);
    await chmod(scratch, 0o777);
    await writeFile(key, randomBytes(48).toString("hex"), { mode: 0o444 });
    const server = resolve(directory, "s3.cjs");
    // A private synthetic S3 fixture exercises the production AWS client and real
    // ciphertext readback. The Docker bridge has no published ports.
    await writeFile(
      server,
      `
    const http = require("node:http");
    const objects = new Map();
    http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      const key = url.pathname.slice("/orbit-e2e-backups/".length);
      if (req.method === "PUT") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        objects.set(key, Buffer.concat(chunks));
        res.setHeader("etag", '"fixture"');
        return res.end();
      }
      if (url.searchParams.get("list-type") === "2") {
        res.setHeader("content-type", "application/xml");
        return res.end("<ListBucketResult><IsTruncated>false</IsTruncated>" +
          [...objects.keys()].map(key => "<Contents><Key>" + key + "</Key></Contents>").join("") + "</ListBucketResult>");
      }
      const body = objects.get(key);
      if (!body) { res.statusCode = 404; return res.end(); }
      res.setHeader("content-length", body.length);
      res.end(body);
    }).listen(8080, "0.0.0.0");
  `,
    );
    docker("image", "inspect", image);
    docker("network", "create", "--internal", name);
    try {
      docker("network", "connect", "--alias", "postgres", name, container);
      docker(
        "run",
        "-d",
        "--rm",
        "--name",
        s3,
        "--network",
        name,
        "--network-alias",
        "orbit-s3-test",
        "--mount",
        `type=bind,src=${server},dst=/fixture.cjs,readonly`,
        node,
        "node",
        "/fixture.cjs",
      );
      const isolatedEnv = {
        ...env,
        POSTGRES_USER: "orbit_restore_admin",
        POSTGRES_PASSWORD: password,
        POSTGRES_DB: database,
      };
      await run(
        "docker",
        [
          "run",
          "-d",
          "--rm",
          "--name",
          db,
          "--network",
          name,
          "--network-alias",
          "orbit-restore-db",
          "--env",
          "POSTGRES_USER",
          "--env",
          "POSTGRES_PASSWORD",
          "--env",
          "POSTGRES_DB",
          "--tmpfs",
          "/var/lib/postgresql/data:rw,size=536870912",
          postgres,
        ],
        { env: isolatedEnv },
      );
      for (let attempt = 0; ; attempt++) {
        try {
          docker(
            "exec",
            db,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            "orbit_restore_admin",
            "-d",
            database,
          );
          break;
        } catch {
          if (attempt >= 60)
            throw new Error("Disposable restore database unavailable");
          await delay(500);
        }
      }
      const use = (command, url) =>
        run(
          "docker",
          [
            "run",
            "--rm",
            "--network",
            name,
            "--read-only",
            "--tmpfs",
            "/var/lib/postgresql/data:rw,noexec,nosuid,size=1048576",
            "--mount",
            `type=bind,src=${scratch},dst=/scratch`,
            "--mount",
            `type=bind,src=${key},dst=/passphrase,readonly`,
            "--env",
            "DIRECT_DATABASE_URL",
            "--env",
            "NODE_ENV=test",
            "--env",
            "ORBIT_BACKUP_R2_ENDPOINT=http://orbit-s3-test:8080",
            "--env",
            "ORBIT_BACKUP_R2_BUCKET=orbit-e2e-backups",
            "--env",
            "ORBIT_BACKUP_R2_ACCESS_KEY_ID=synthetic",
            "--env",
            "ORBIT_BACKUP_R2_SECRET_ACCESS_KEY=synthetic",
            "--env",
            "ORBIT_BACKUP_PASSPHRASE_FILE=/passphrase",
            "--env",
            "ORBIT_BACKUP_SCRATCH=/scratch",
            image,
            command,
          ],
          { env: { ...env, DIRECT_DATABASE_URL: url } },
        );
      await use(
        "backup",
        `postgresql://orbit_backup:${env.BACKUP_DATABASE_PASSWORD}@postgres:5432/${env.POSTGRES_DB}`,
      );
      await use(
        "verify",
        `postgresql://orbit_restore_admin:${password}@orbit-restore-db:5432/${database}`,
      );
      const result = docker(
        "exec",
        db,
        "psql",
        "-U",
        "orbit_restore_admin",
        "-d",
        database,
        "-Atc",
        "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;",
      );
      assert.ok(Number(result) >= 148);
    } finally {
      for (const service of [db, s3]) {
        try {
          docker("stop", "-t", "3", service);
        } catch {}
      }
      docker("network", "disconnect", name, container);
      docker("network", "rm", name);
    }
  },
  { postgresTmpfs: true, backupProof: true },
);
