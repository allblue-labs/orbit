import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  backend,
  run,
  withIntegrationEnvironment,
} from "./lib/integration-environment.mjs";

const require = createRequire(join(backend, "package.json"));
const { PrismaClient, Prisma } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

await withIntegrationEnvironment(
  async ({ env, compiled }) => {
    await run(process.execPath, [join(compiled, "src/scripts/seed-owner.js")], {
      cwd: backend,
      env: {
        ...env,
        OWNER_EMAIL: "analytics-benchmark@orbit.local",
        OWNER_PASSWORD: randomUUID(),
        OWNER_FIRST_NAME: "Benchmark",
        OWNER_LAST_NAME: "Analytics",
        OWNER_ORGANIZATION_NAME: "Analytics fixture",
      },
    });
    const load = (path) => require(join(compiled, "src", path));
    const { RequestContext, RequestContextService, RequestContextStorage } =
      load("context");
    const { RlsTransaction } = load("database");
    const { RlsContextProvider } = load("database/rls/rls-context.provider");
    const { AnalyticsRepository } = load(
      "modules/analytics/analytics.repository",
    );
    const { analyticsAccess } = load(
      "modules/analytics/analytics-authorization",
    );
    const { operationAnalytics } = load("modules/analytics/analytics.queries");
    const admin = new PrismaClient({ adapter: new PrismaPg(env.DATABASE_URL) });
    const runtime = new PrismaClient({
      adapter: new PrismaPg(env.APP_DATABASE_URL),
      log: [{ emit: "event", level: "query" }],
    });
    const queries = [];
    runtime.$on("query", ({ query }) => queries.push(query));
    const history = { closed: 100_000, oldOpen: 8_000, recent: 4_000 };
    const older = history.closed + history.oldOpen;
    try {
      const [role] = await runtime.$queryRaw`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
      assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
      const unit = await admin.businessUnit.findFirstOrThrow({
        where: { organization: { displayName: "Analytics fixture" } },
        select: {
          id: true,
          organizationId: true,
          organization: { select: { ownerUserId: true } },
        },
      });
      const { organizationId, id: businessUnitId } = unit;
      // Only fixtures are inserted on this administrative connection, with
      // valid foreign keys. Skip row triggers for bulk loading in an empty,
      // disposable database. Reads below use ordinary restricted connections.
      await admin.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
          await tx.$executeRaw`
        INSERT INTO operations (
          id, organization_id, business_unit_id, code, title, kind, status,
          created_at, updated_at, completed_at, scheduled_end
        )
        SELECT gen_random_uuid(), ${organizationId}::uuid, ${businessUnitId}::uuid,
               'PR16-' || n, 'Synthetic analytics', 'MAINTENANCE',
               CASE WHEN n <= ${history.oldOpen} THEN 'OPEN' ELSE 'COMPLETED' END,
               CASE WHEN n <= ${older} THEN '2025-01-01'::timestamptz
                    ELSE '2026-11-02'::timestamptz END, now(),
               CASE WHEN n <= ${history.oldOpen} THEN NULL
                    WHEN n <= ${older} THEN '2025-01-02'::timestamptz
                    ELSE '2026-11-03'::timestamptz END,
               '2026-11-04'::timestamptz
          FROM generate_series(1, ${older + history.recent}::int) AS n
      `;
        },
        { timeout: 240_000 },
      );
      await admin.$executeRaw`ANALYZE operations`;
      const contexts = new RequestContextStorage();
      const rls = new RlsTransaction(
        runtime,
        new RlsContextProvider(new RequestContextService(contexts)),
      );
      const inScope = (work) =>
        contexts.run(
          new RequestContext({
            requestId: randomUUID(),
            actorType: "INTERNAL_USER",
            userId: unit.organization.ownerUserId,
            organizationId,
            businessUnitId,
            businessUnitIds: [businessUnitId],
            roles: ["OWNER"],
            permissions: ["*"],
            ip: null,
            userAgent: null,
            locale: "pt-BR",
          }),
          work,
        );
      const range = {
        from: new Date("2026-11-01T03:00:00Z"),
        to: new Date("2026-11-10T15:00:00Z"),
        previousFrom: new Date("2026-10-22T15:00:00Z"),
        previousTo: new Date("2026-11-01T02:59:59.999Z"),
        granularity: "DAY",
        businessUnitId,
      };
      const legacy = () =>
        inScope(() =>
          rls.run((tx) =>
            tx.operation.findMany({
              where: {
                organizationId,
                businessUnitId,
                deletedAt: null,
                createdAt: { lte: range.to },
                OR: [
                  { createdAt: { gte: range.previousFrom } },
                  { completedAt: { gte: range.previousFrom } },
                  { status: { notIn: ["COMPLETED", "CANCELLED"] } },
                ],
              },
              select: {
                id: true,
                status: true,
                createdAt: true,
                completedAt: true,
                scheduledStart: true,
                scheduledEnd: true,
                startedAt: true,
                responsibleFieldTechnicianId: true,
              },
              orderBy: { createdAt: "asc" },
            }),
          ),
        );
      const repo = new AnalyticsRepository(rls);
      const domains = analyticsAccess(["*"]).domains;
      const aggregate = () =>
        inScope(() => repo.snapshot(organizationId, range, domains));

      const measure = async (read) => {
        global.gc?.();
        const heapBefore = process.memoryUsage().heapUsed;
        const started = performance.now();
        const result = await read();
        return {
          result,
          elapsedMs: performance.now() - started,
          heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
          resultBytes: Buffer.byteLength(JSON.stringify(result)),
        };
      };
      await aggregate(); // Warm Prisma and PostgreSQL before measuring.
      const old = await measure(legacy);
      queries.length = 0;
      const next = await measure(aggregate);
      const dataQueries = queries.filter(
        (sql) => !/^(BEGIN|COMMIT|ROLLBACK|SELECT set_config)/i.test(sql),
      ).length;
      assert.equal(dataQueries, 5);
      assert.equal(old.result.length, history.oldOpen + history.recent);
      assert.equal(next.result.operations.open, history.oldOpen);
      assert.equal(next.result.operations.current.cohort, history.recent);
      assert.equal(next.result.operations.current.onTime, history.recent);
      assert.equal(next.result.operations.current.withDeadline, history.recent);
      assert.equal(next.result.operations.previous.delivered, 0);
      assert(next.resultBytes < 4000);
      assert(old.resultBytes > next.resultBytes * 100);

      const [explained] = await inScope(() =>
        rls.run((tx) =>
          tx.$queryRaw(
            Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${operationAnalytics(organizationId, range, true, true)}`,
          ),
        ),
      );
      const [plan] = explained["QUERY PLAN"];
      const indexes = [
        ...JSON.stringify(plan).matchAll(/"Index Name":"([^"]+)"/g),
      ].map((entry) => entry[1]);
      assert(indexes.includes("operations_analytics_open_idx"));
      const evidence = ({ result: _, ...metrics }) => metrics;
      console.log(
        JSON.stringify({
          event: "pr16_analytics_benchmark",
          history,
          dataQueries,
          legacy: { rows: old.result.length, ...evidence(old) },
          aggregated: evidence(next),
          indexes,
          databaseExecutionMs: plan["Execution Time"],
          sharedHitBlocks: plan.Plan["Shared Hit Blocks"],
          sharedReadBlocks: plan.Plan["Shared Read Blocks"],
        }),
      );
    } finally {
      await Promise.all([runtime.$disconnect(), admin.$disconnect()]);
    }
  },
  { postgresTmpfs: true },
);
