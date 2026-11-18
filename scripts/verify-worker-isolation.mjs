import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { backend, withIntegrationEnvironment } from "./lib/integration-environment.mjs";
import { withHttpTestStack } from "./lib/http-test-stack.mjs";

const require = createRequire(join(backend, "package.json"));
const { Client } = require("pg");

// Each consumer uses the real Nest context and PostgreSQL queue. Replace just
// the processors' business actions to reproduce load and provider delay without
// credentials or notification delivery. The PDF renderer and S3 SDK are real.
const fixture = String.raw`
  const { join } = require('node:path');
  const { performance } = require('node:perf_hooks');
  const load = name => require(join(process.env.ORBIT_E2E_DIRECTORY, 'compiled/src', name));
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = load('app.module');
  const { JobProcessorRegistry } = load('modules/jobs/job-processor.registry');
  const { ArtifactPremiumPdfRenderer } = load('modules/artifact-rendering/renderers/pdf/artifact-premium-pdf.renderer');
  const { sampleRenderInput } = load('modules/artifact-rendering/sample-document.factory');
  const { S3CompatibleStorageProvider } = load('modules/storage/providers/s3-compatible.storage');
  (async () => {
    const app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
    const roles = app.get(JobProcessorRegistry).all();
    const docs = roles.find(p => p.queue === 'artifact.render');
    const pushes = roles.find(p => p.queue === 'mobile.push.delivery');
    const storage = new S3CompatibleStorageProvider('MINIO', 'fixture', {
      endpoint: process.env.FIXTURE_STORAGE_URL, region: 'us-east-1',
      accessKeyId: 'fixture', secretAccessKey: 'fixture', forcePathStyle: true, deadlineMs: 2500
    });
    docs.process = async () => {
      const started = performance.now();
      const renderer = new ArtifactPremiumPdfRenderer();
      const input = sampleRenderInput('ORDEM_SERVICO');
      for (let i = 0; i < 8; i++) {
        const output = await renderer.render(input);
        if (!output.bytes.subarray(0, 4).equals(Buffer.from('%PDF'))) throw Error('Missing PDF');
      }
      await storage.get({ bucket: 'fixture', objectKey: 'slow.pdf' });
      throw Error('Stalled provider should have failed');
    };
    pushes.process = async () => process.send({ event: 'push-fixture', rssBytes: process.memoryUsage.rss() });
    process.send({ event: 'ready' });
  })().catch(() => process.exit(1));
`;

async function eventually(probe, interval = 100) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const value = await probe();
    if (value) return value;
    await wait(interval);
  }
  throw Error("Timed out waiting for fixture condition");
}

await withIntegrationEnvironment(async ({ env, compiled }) => {
  Object.assign(env, {
    ORBIT_PROCESS_ROLE: "api",
    DATABASE_POOL_MAX: "8",
    // These settings apply only to the fixture workers after the HTTP stack
    // starts. Current DB is disposable and provider jobs are never enabled.
    ACCOUNT_EMAIL_DELIVERY_ENABLED: "false",
    PUBLIC_CONTACT_DELIVERY_ENABLED: "false",
    PUSH_PROVIDER: "disabled",
    BILLING_EVENTS_WORKER_ENABLED: "false",
    SUBSCRIPTION_LIFECYCLE_WORKER_ENABLED: "false",
    SUBSCRIPTION_DATA_RETENTION_ENABLED: "false",
    PUBLIC_CONTACT_ENABLED: "false",
  });
  const observer = join(env.ORBIT_E2E_DIRECTORY, "runtime-sample.cjs");
  const samplesFile = join(env.ORBIT_E2E_DIRECTORY, "runtime-samples.jsonl");
  await writeFile(observer, `
    if (process.argv[1]?.endsWith('/main.js')) {
      const loop = require('node:perf_hooks').monitorEventLoopDelay({resolution: 10});
      loop.enable();
      setInterval(() => {
        require('node:fs').appendFileSync(${JSON.stringify(samplesFile)}, JSON.stringify({
          timestamp: Date.now(), eventLoopP95Ms: loop.percentile(95) / 1e6,
          rssBytes: process.memoryUsage.rss()
        }) + '\\n');
        loop.reset();
      }, 250).unref();
    }
  `);
  env.NODE_OPTIONS = `--require=${observer}`;
  await withHttpTestStack(env, { compiled, web: false }, async () => {
    let streamStartedAt;
    let streamClosedAt;
    const storage = createServer((_req, res) => {
      streamStartedAt = performance.now();
      res.on("close", () => { streamClosedAt = performance.now(); });
      res.writeHead(200, { "Content-Length": "2000", "Content-Type": "application/pdf" });
      res.write("partial-body");
    });
    storage.listen(0, "127.0.0.1");
    await once(storage, "listening");
    const db = new Client({ connectionString: env.DATABASE_URL });
    const children = [];
    let pushAt;
    let pushRss;
    const logs = [];
    try {
      await db.connect();
      for (const [role, limit] of [["worker", "6"], ["documents", "4"]]) {
        const child = spawn(process.execPath, ["-e", fixture], {
          cwd: backend,
          env: { ...env, DATABASE_URL: "", ORBIT_PROCESS_ROLE: role,
            JOBS_WORKER_ENABLED: "true", JOBS_POLL_INTERVAL_MS: "250",
            DATABASE_POOL_MAX: limit, FIXTURE_STORAGE_URL: `http://127.0.0.1:${storage.address().port}` },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        children.push(child);
        child.stdout.on("data", chunk => logs.push(chunk.toString()));
        child.stderr.on("data", chunk => logs.push(chunk.toString()));
        let started = false;
        child.on("message", value => {
          if (value.event === "ready") started = true;
          if (value.event === "push-fixture") { pushAt = performance.now(); pushRss = value.rssBytes; }
        });
        await eventually(() => {
          assert.equal(child.exitCode, null, "Dedicated worker exited");
          return started;
        });
      }
      const { rows: [unit] } = await db.query("SELECT id, organization_id FROM business_units LIMIT 1");
      async function job(queue) {
        const id = randomUUID();
        await db.query(`INSERT INTO background_jobs (id, organization_id, business_unit_id, scope,
          business_unit_ids, queue, job_key, correlation_id, max_attempts)
          VALUES ($1, $2, $3, 'BUSINESS_UNIT', ARRAY[$3::uuid], $4, $1::uuid::text, $1::uuid::text, 1)`,
          [id, unit.organization_id, unit.id, queue]);
        return id;
      }
      const login = await fetch(env.ORBIT_API_URL + "/identity/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD }),
      });
      assert.equal(login.status, 200);
      const { data: session } = await login.json();
      const pdf = await fetch(env.ORBIT_API_URL + "/artifact-rendering/samples/ORDEM_SERVICO", {
        headers: { authorization: `Bearer ${session.accessToken}` },
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(pdf.status, 200, "Synchronous HTTP sample must survive thread offload");
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
      const documentJob = await job("artifact.render");
      const latency = [];
      const measurementStarted = Date.now();
      const request = async () => {
        const started = performance.now();
        const response = await fetch(new URL("/health/ready", env.ORBIT_API_URL), {signal: AbortSignal.timeout(3000)});
        assert.equal(response.status, 200);
        await response.text();
        latency.push(performance.now() - started);
      };
      let probing = true;
      const probes = Promise.all(Array.from({length: 4}, async () => {
        while (probing) { await request(); await wait(25); }
      }));
      let pushedJob;
      let queuedAt;
      let peakConnections = 0;
      try {
        await eventually(() => streamStartedAt);
        queuedAt = performance.now();
        pushedJob = await job("mobile.push.delivery");
        await eventually(async () => {
          const { rows: [{ connections }] } = await db.query(
            "SELECT count(*)::int AS connections FROM pg_stat_activity WHERE application_name IN ('orbit-api', 'orbit-worker', 'orbit-documents')",
          );
          peakConnections = Math.max(peakConnections, connections);
          return streamClosedAt;
        }, 50);
      } finally {
        probing = false;
        await probes;
      }
      assert(pushAt < streamClosedAt, "Push lane must complete before the stalled object body closes");
      assert(streamClosedAt - streamStartedAt < 4500, "Storage body cancellation exceeded the total deadline");
      await eventually(async () => {
        const { rows } = await db.query("SELECT id, status FROM background_jobs WHERE id = ANY($1::uuid[])", [[documentJob, pushedJob]]);
        return rows.find(row => row.id === documentJob)?.status === "DEAD" &&
          rows.find(row => row.id === pushedJob)?.status === "SUCCEEDED";
      });
      const sorted = latency.toSorted((a, b) => a - b);
      assert(sorted.length >= 20);
      const p95 = sorted[Math.ceil(sorted.length * .95) - 1];
      assert(p95 < 500, "Readiness p95 too high under isolated load");
      assert(peakConnections > 0 && peakConnections <= 18);
      const joined = logs.join("");
      assert.match(joined, /"result":"deadline"/);
      const snapshots = [...joined.matchAll(/(\{"event":"worker_queue_snapshot".*\})/g)].map(match => JSON.parse(match[1]));
      assert(snapshots.some(snapshot => snapshot.role === "documents"));
      // Use an existing disabled consumer role and the restricted runtime DSN
      // to force a lease expiry and ensure the old owner cannot close a replay.
      const { PrismaService } = require(join(compiled, "src/database/prisma.service"));
      const { BackgroundJobQueue } = require(join(compiled, "src/modules/jobs/background-job.queue"));
      const values = { NODE_ENV: "test", APP_DATABASE_URL: env.APP_DATABASE_URL };
      const prisma = new PrismaService({ get: key => values[key], getOptional: key => values[key] });
      try {
        // Hold the document row in READY state until the test owns it.
        await db.query("UPDATE background_jobs SET available_at = now() + interval '10 minutes' WHERE id = $1", [documentJob]);
        assert.equal(await new BackgroundJobQueue(prisma, null).replayDead(documentJob, "mobile.push.delivery"), false);
        const { rows: [before] } = await db.query("SELECT attempts, status, last_error FROM background_jobs WHERE id = $1", [documentJob]);
        assert.equal(before.attempts, 1);
        assert.equal(before.status, "DEAD");
        const queue = new BackgroundJobQueue(prisma, null);
        // Stop the only consumer for this queue to make the claim deterministic.
        const docs = children[1];
        const exited = once(docs, "exit");
        docs.kill("SIGTERM");
        await exited;
        assert.equal(await queue.replayDead(documentJob, "artifact.render"), true);
        assert.equal(await queue.replayDead(documentJob, "artifact.render"), false);
        const first = await queue.claim("artifact.render", "fixture-lease-old");
        assert(first);
        await db.query("UPDATE background_jobs SET locked_at = now() - interval '30 minutes' WHERE id = $1", [documentJob]);
        assert.equal(await queue.requeueStalled("artifact.render", 300000), 1);
        assert.equal(await queue.succeed(first), false);
        assert.equal(await queue.fail(first, "FIXTURE_FAILURE"), "LEASE_LOST");
        assert.equal((await queue.find(documentJob)).status, "DEAD");
      } finally {
        await prisma.$disconnect();
      }
      const apiSamples = (await readFile(samplesFile, "utf8")).trim().split("\n")
        .map(line => JSON.parse(line)).filter(sample => sample.timestamp >= measurementStarted);
      assert(apiSamples.length >= 2);
      const apiEventLoopP95MaxMs = Math.max(...apiSamples.map(sample => sample.eventLoopP95Ms));
      const apiRssPeakBytes = Math.max(...apiSamples.map(sample => sample.rssBytes));
      assert(apiEventLoopP95MaxMs < 150);
      console.log(JSON.stringify({
        result: "PASS", fencedLeaseAndReplay: true, readinessSamples: sorted.length, readinessP95Ms: Math.round(p95 * 100) / 100,
        pushQueueAgeMs: Math.round(pushAt - queuedAt), storageBodyClosedMs: Math.round(streamClosedAt - streamStartedAt),
        peakConnections, apiEventLoopP95MaxMs, apiRssPeakBytes, pushRssBytes: pushRss,
      }));
    } catch (error) {
      console.error(logs.join("").split("\n").slice(-20).join("\n"));
      throw error;
    } finally {
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        await exited;
        clearTimeout(timer);
      }
      storage.closeAllConnections();
      storage.close();
      await db.end();
    }
  });
}, { postgresTmpfs: true });
