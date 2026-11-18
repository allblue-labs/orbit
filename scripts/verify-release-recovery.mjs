import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { withHttpTestStack } from "./lib/http-test-stack.mjs";
import {
  backend,
  root,
  run,
  withIntegrationEnvironment,
} from "./lib/integration-environment.mjs";

const [rollbackRevision, ...extra] = process.argv.slice(2);
if (
  extra.length ||
  (rollbackRevision && !/^[a-f0-9]{40}$/.test(rollbackRevision))
) {
  throw new Error(
    "Provide one full Git SHA for the optional backend rollback check",
  );
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const foreign = {
  email: "recovery.other.owner@orbit.local",
  password: "Orbit#RecoveryFixture@2026",
};

function apiClient(env) {
  return async (
    path,
    { token, method = "GET", body, statuses = [200] } = {},
  ) => {
    const response = await fetch(`${env.ORBIT_API_URL}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    assert.ok(
      statuses.includes(response.status),
      `${method} ${path}: HTTP ${response.status}`,
    );
    if (response.status >= 400) return undefined;
    return (await response.json()).data;
  };
}

async function authenticate(env) {
  const api = apiClient(env);
  const login = async (credentials) =>
    (
      await api("/identity/login", {
        method: "POST",
        body: credentials,
        statuses: [200, 201],
      })
    ).accessToken;
  const token = await login({
    email: env.OWNER_EMAIL,
    password: env.OWNER_PASSWORD,
  });
  return { api, token, foreignToken: await login(foreign) };
}

async function issuePdf(api, token) {
  const organization = await api("/organizations/current", { token });
  const write = (path, body, method = "POST", statuses = [201]) =>
    api(path, { token, method, body, statuses });
  const template = await write("/artifact-templates", {
    key: "RECOVERY_CHECK",
    name: "Qualificação de restore",
    artifactType: "RELATORIO_TECNICO",
    sections: [
      {
        id: "inspecao",
        title: "Inspeção",
        order: 1,
        type: "FORM",
        fields: [{ id: "local", label: "Local", type: "TEXT", order: 1 }],
      },
    ],
    signatureSlots: [],
    layout: { reusableBlocks: [] },
    metadata: {},
  });
  await write(`/artifact-templates/${template.id}/activate`, {});
  const execution = await write("/artifact-executions", {
    businessUnitId: organization.businessUnits[0].id,
    templateId: template.id,
    code: "DOC-RECOVERY",
    title: "Relatório sintético de restore",
  });
  const base = `/artifact-executions/${execution.id}`;
  await write(
    `${base}/responses`,
    { sectionId: "inspecao", fieldId: "local", value: "Sala de teste" },
    "PUT",
    [200],
  );
  for (const status of ["IN_PROGRESS", "UNDER_REVIEW"]) {
    await write(`${base}/status`, { status }, "PATCH", [200]);
  }
  await write(`${base}/render`, { renderer: "pdf.default" }, "POST", [202]);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { data: revisions } = await api(`${base}/manifests`, { token });
    const active = revisions.find(
      (entry) => entry.isActive && entry.status === "ISSUED",
    );
    if (active)
      return {
        id: active.id,
        hash: active.contentHash,
        executionId: execution.id,
      };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Document worker did not issue the test report");
}

async function readPdf(env, session, fixture) {
  const path = `/artifact-manifests/${fixture.id}/download`;
  const { url } = await session.api(path, { token: session.token });
  const signed = new URL(url);
  assert.equal(signed.origin, new URL(env.ORBIT_API_URL).origin);
  const response = await fetch(signed, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal(digest(bytes), fixture.hash);
  await session.api(path, {
    token: session.foreignToken,
    statuses: [403, 404],
  });
  const revisions = await session.api(
    `/artifact-executions/${fixture.executionId}/manifests`,
    { token: session.token },
  );
  assert.equal(revisions.data.length, 1);
}

function restoredUrl(raw, database) {
  const url = new URL(raw);
  assert.equal(url.hostname, "127.0.0.1");
  url.pathname = database;
  return url.toString();
}

async function compileRollback(env, directory) {
  const sources = resolve(directory, "rollback-src");
  const compiled = resolve(directory, "rollback-compiled");
  await mkdir(sources);
  const archive = execFileSync(
    "git",
    ["archive", rollbackRevision, "backend"],
    {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  execFileSync("tar", ["-x", "-C", sources], { input: archive });
  const cwd = resolve(sources, "backend");
  await symlink(resolve(backend, "node_modules"), resolve(cwd, "node_modules"));
  await run(
    process.execPath,
    [
      resolve(backend, "node_modules/typescript/bin/tsc"),
      "--project",
      "tsconfig.build.json",
      "--outDir",
      compiled,
      "--incremental",
      "false",
    ],
    { cwd, env },
  );
  await symlink(
    resolve(backend, "node_modules"),
    resolve(compiled, "node_modules"),
  );
  return compiled;
}

await withIntegrationEnvironment(
  async ({ env, directory, compiled, container }) => {
    assert.match(container, /^orbit-e2e-[a-f0-9]{16}$/);
    assert.match(env.POSTGRES_DB, /^orbit_e2e_[a-f0-9]{16}$/);
    const dockerPg = (args, options = {}) =>
      execFileSync(
        "docker",
        ["exec", ...("input" in options ? ["-i"] : []), container, ...args],
        { env, maxBuffer: 32 * 1024 * 1024, ...options },
      );
    const sql = (database, statement) =>
      dockerPg(
        [
          "psql",
          "-U",
          env.POSTGRES_USER,
          "-d",
          database,
          "-At",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          statement,
        ],
        { encoding: "utf8" },
      ).trim();
    await run(
      process.execPath,
      [resolve(compiled, "src/scripts/seed-owner.js")],
      {
        cwd: backend,
        env: {
          ...env,
          OWNER_EMAIL: foreign.email,
          OWNER_PASSWORD: foreign.password,
          OWNER_FIRST_NAME: "Controle",
          OWNER_LAST_NAME: "Restore",
          OWNER_ORGANIZATION_NAME: "Tenant de controle do restore",
        },
      },
    );
    let fixture;
    await withHttpTestStack(env, { compiled, web: false }, async (runtime) => {
      const session = await authenticate(runtime);
      fixture = await issuePdf(session.api, session.token);
      await readPdf(runtime, session, fixture);
    });

    // Both writers are stopped before taking the database and object copies.
    const started = performance.now();
    const dump = dockerPg([
      "pg_dump",
      "-Fc",
      "-U",
      env.POSTGRES_USER,
      env.POSTGRES_DB,
    ]);
    await writeFile(resolve(directory, "database.dump"), dump, { mode: 0o600 });
    const snapshots = resolve(directory, "object-backup");
    const objects = resolve(directory, "restored-objects");
    await cp(env.STORAGE_LOCAL_DIR, snapshots, { recursive: true });
    await cp(snapshots, objects, { recursive: true });
    const database = `${env.POSTGRES_DB}_restore`;
    dockerPg(["createdb", "-U", env.POSTGRES_USER, database]);
    dockerPg(
      [
        "pg_restore",
        "--exit-on-error",
        "-U",
        env.POSTGRES_USER,
        "-d",
        database,
      ],
      { input: dump },
    );
    const restored = {
      ...env,
      DATABASE_URL: restoredUrl(env.DATABASE_URL, database),
      APP_DATABASE_URL: restoredUrl(env.APP_DATABASE_URL, database),
      STORAGE_LOCAL_DIR: objects,
    };
    assert.equal(
      sql(
        database,
        "SELECT rolsuper::int || ':' || rolbypassrls::int FROM pg_roles WHERE rolname = 'orbit_app'",
      ),
      "0:0",
    );
    await run("npm", ["exec", "--", "prisma", "migrate", "status"], {
      cwd: backend,
      env: restored,
    });
    const verify = async (candidate) => {
      await withHttpTestStack(
        { ...restored },
        { compiled: candidate, web: false },
        async (runtime) => {
          await readPdf(runtime, await authenticate(runtime), fixture);
        },
      );
    };
    await verify(compiled);
    console.log(
      JSON.stringify({
        event: "pr19_restore",
        provider: "LOCAL",
        backupBytes: dump.length,
        migrations: Number(
          sql(
            database,
            'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
          ),
        ),
        sha256Verified: true,
        crossTenantDenied: true,
        activeRevisions: 1,
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
    if (rollbackRevision) {
      execFileSync(
        "git",
        [
          "diff",
          "--quiet",
          rollbackRevision,
          "HEAD",
          "--",
          "backend/package-lock.json",
          "backend/prisma/schema.prisma",
        ],
        { cwd: root },
      );
      await verify(await compileRollback(env, directory));
      console.log(
        JSON.stringify({
          event: "pr19_source_rollback",
          revision: rollbackRevision,
          schemaRollback: false,
          sha256Verified: true,
        }),
      );
    }
  },
  { postgresTmpfs: true },
);
