import assert from "node:assert/strict";
import { open, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  run,
  withIntegrationEnvironment,
} from "./lib/integration-environment.mjs";

const [, , file, sourceOwner] = process.argv;
if (
  !file ||
  !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(sourceOwner ?? "") ||
  /^pg_/i.test(sourceOwner)
)
  throw new Error(
    "Use qualify-staging.sh SNAPSHOT_SANITIZADO.dump DONO_DO_BANCO_DE_ORIGEM",
  );
const snapshot = resolve(file);
const source = await stat(snapshot);
assert.ok(
  source.isFile() && (source.mode & 0o077) === 0,
  "Use um snapshot sanitizado com permissão 600.",
);
const started = performance.now();
const psql = ({ env, container }, sql) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      env.POSTGRES_USER,
      "-d",
      env.POSTGRES_DB,
    ],
    { env, input: sql, stdio: ["pipe", "pipe", "pipe"] },
  )
    .toString()
    .trim();

const beforeMigrate = async (test) => {
  const { env, container } = test;
  const roles = [
    ...new Set([
      sourceOwner,
      "orbit_worker",
      "orbit_documents",
      "orbit_queue_worker",
      "orbit_identity_definer",
      "orbit_export_definer",
      "orbit_backup",
    ]),
  ].filter((role) => ![env.POSTGRES_USER, "orbit_app"].includes(role));
  psql(
    test,
    roles
      .map((role) => `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS;`)
      .join("\n"),
  );
  const handle = await open(snapshot);
  try {
    await run(
      "docker",
      [
        "exec",
        "-i",
        container,
        "pg_restore",
        "--clean",
        "--if-exists",
        "--exit-on-error",
        "--single-transaction",
        "-U",
        env.POSTGRES_USER,
        "-d",
        env.POSTGRES_DB,
      ],
      { env, stdio: [handle.fd, "ignore", "ignore"] },
    );
  } finally {
    await handle.close();
  }
  const verified = psql(
    test,
    `
    SELECT NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND NOT convalidated);
  `,
  );
  assert.equal(verified, "t", "O snapshot contém alterações incompletas.");
};

await withIntegrationEnvironment(
  async (test) => {
    const result = psql(
      test,
      `
    DO $$
    BEGIN
      IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('orbit_app','orbit_worker','orbit_documents')
          AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole))<>3
      THEN RAISE EXCEPTION 'unsafe_runtime_roles'; END IF;
      IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')
          AND relname NOT IN ('_prisma_migrations','modules','pmoc_plan_name_options')
          AND NOT (relrowsecurity AND relforcerowsecurity))
      THEN RAISE EXCEPTION 'incomplete_force_rls'; END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND NOT convalidated)
      THEN RAISE EXCEPTION 'unvalidated_foreign_keys'; END IF;
    END $$;
    BEGIN;
    CREATE TEMP TABLE scope_fixture AS
    SELECT organization_id, array_agg(DISTINCT business_unit_id ORDER BY business_unit_id) units
    FROM assets WHERE deleted_at IS NULL GROUP BY organization_id
      HAVING count(DISTINCT business_unit_id)>1 LIMIT 1;
    CREATE TEMP TABLE foreign_fixture AS SELECT id FROM organizations
      WHERE id<>(SELECT organization_id FROM scope_fixture) LIMIT 1;
    GRANT SELECT ON scope_fixture,foreign_fixture TO orbit_app;
    SET LOCAL ROLE orbit_app;
    DO $$
    DECLARE org uuid; mine uuid; other uuid; foreign_org uuid;
    BEGIN
      SELECT organization_id,units[1],units[2] INTO org,mine,other FROM scope_fixture;
      SELECT id INTO foreign_org FROM foreign_fixture;
      IF org IS NULL OR foreign_org IS NULL THEN RAISE EXCEPTION 'missing_snapshot_scope_fixtures'; END IF;
      PERFORM set_config('app.organization_id',org::text,true);
      PERFORM set_config('app.business_unit_ids',mine::text,true);
      IF NOT EXISTS(SELECT 1 FROM assets WHERE organization_id=org AND business_unit_id=mine)
        OR EXISTS(SELECT 1 FROM assets WHERE business_unit_id=other)
        OR EXISTS(SELECT 1 FROM organizations WHERE id=foreign_org)
      THEN RAISE EXCEPTION 'staging_rls_qualification_failed'; END IF;
    END $$;
    ROLLBACK;
    SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  `,
    );
    assert.match(result, /^\d+$/);
    console.log(
      JSON.stringify({
        event: "orbit_staging_snapshot_qualified",
        result: "PASS",
        migrations: Number(result),
        durationMs: Math.round(performance.now() - started),
      }),
    );
  },
  { postgresTmpfs: true, separateWorkers: true, beforeMigrate },
);
