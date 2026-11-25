import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const [, , configPath, referencePath] = process.argv;
if (!configPath || ((await stat(configPath)).mode & 0o077) !== 0)
  throw new Error(
    "Informe o arquivo de credenciais do teste com permissão 600.",
  );

const config = JSON.parse(await readFile(configPath, "utf8"));
assert.equal(config.environment, "staging");
assert.match(config.dataset ?? "", /^[A-Za-z0-9_.-]{1,80}$/);
const target = new URL(config.baseUrl);
assert.ok(
  ["https:", "http:"].includes(target.protocol) &&
    !target.username &&
    !target.password &&
    !target.search &&
    !target.hash,
);
assert.equal(target.pathname.replace(/\/$/, ""), "/api/v1");
if (target.protocol === "http:") assert.equal(target.hostname, "127.0.0.1");
else assert.equal(target.hostname, "orbit.allblue-labs.com");
assert.match(config.expectedCommit ?? "", /^[a-f0-9]{40}$/);
const legacyRevision = "3a2c541821ec65589fdab68ad4718497091eba16";
const poolMode = config.poolMode ?? "pgbouncer";
assert.ok(["legacy-direct", "pgbouncer"].includes(poolMode));
if (poolMode === "legacy-direct") {
  assert.equal(config.expectedCommit, legacyRevision);
  assert.equal(
    referencePath,
    undefined,
    "Somente a baseline usa PostgreSQL direto.",
  );
} else {
  assert.ok(
    typeof config.poolMetrics === "string" && config.poolMetrics.length,
  );
  assert.notEqual(config.expectCorrelation, false);
}

const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const stages = config.concurrency ?? [5, 10, 20];
assert.ok(
  Array.isArray(stages) &&
    stages.length > 0 &&
    stages.length <= 3 &&
    stages.every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 20,
    ),
);
const seconds = config.secondsPerStage ?? 60;
assert.ok(Number.isInteger(seconds) && seconds >= 10 && seconds <= 180);
const minimumPoolSamples = Math.max(3, Math.floor(seconds / 10));
assert.ok(
  Array.isArray(config.actors) && config.actors.length >= Math.max(...stages),
);
assert.ok(
  config.actors.every(
    ({ quoteId, token, organizationId }) =>
      idPattern.test(quoteId) &&
      idPattern.test(organizationId) &&
      typeof token === "string" &&
      token.length < 4096,
  ),
);
assert.equal(
  new Set(config.actors.map(({ token }) => token)).size,
  config.actors.length,
);
assert.equal(
  new Set(config.actors.map(({ quoteId }) => quoteId)).size,
  config.actors.length,
);
assert.ok(
  new Set(
    config.actors
      .slice(0, Math.max(...stages))
      .map(({ organizationId }) => organizationId),
  ).size >= 2,
);
const datasetFingerprint = createHash("sha256")
  .update(
    JSON.stringify(
      config.actors
        .slice(0, Math.max(...stages))
        .map(({ organizationId, quoteId }) => [organizationId, quoteId]),
    ),
  )
  .digest("hex");
const reference = referencePath
  ? JSON.parse(await readFile(referencePath, "utf8"))
  : null;
if (reference) {
  assert.equal(reference.event, "orbit_staging_load");
  assert.equal(reference.verification, "baseline");
  assert.notEqual(reference.revision, config.expectedCommit);
  assert.equal(reference.target, target.origin);
  assert.equal(reference.seconds, seconds);
  assert.equal(reference.dataset, config.dataset);
  assert.equal(reference.datasetFingerprint, datasetFingerprint);
  assert.deepEqual(
    reference.results.map((stage) => stage.concurrency),
    stages,
  );
  assert.deepEqual(reference.issues, []);
  assert.ok(
    reference.poolMode === "pgbouncer" ||
      (reference.poolMode === "legacy-direct" &&
        reference.revision === legacyRevision),
  );
}

const revision = await fetch(target.origin + "/api/v1/release", {
  signal: AbortSignal.timeout(5_000),
  redirect: "error",
});
assert.ok(revision.ok);
assert.equal((await revision.json()).data.commit, config.expectedCommit);

const call = async (actor, endpoint, method = "GET", expected = 200) => {
  const correlationId = randomUUID();
  const started = performance.now();
  const response = await fetch(target.origin + "/api/v1" + endpoint, {
    method,
    headers: {
      Authorization: "Bearer " + actor.token,
      "X-Correlation-Id": correlationId,
      "X-Request-Id": correlationId,
    },
    signal: AbortSignal.timeout(12_000),
    redirect: "error",
  });
  if (response.status !== expected) throw new Error("HTTP_" + response.status);
  // The reference build can expose the legacy correlation header.
  const echoed =
    response.headers.get("x-correlation-id") ??
    response.headers.get("x-request-id");
  if (config.expectCorrelation !== false && echoed !== correlationId)
    throw new Error("CORRELATION_MISSING");
  return {
    value: (await response.json()).data,
    duration: performance.now() - started,
  };
};

for (const actor of config.actors.slice(0, Math.max(...stages))) {
  const { value } = await call(actor, "/organizations/current");
  assert.equal(
    value.id,
    actor.organizationId,
    "A conta do cenário deve ter o tenant esperado.",
  );
  await call(actor, "/quotes/" + actor.quoteId);
}

const percentiles = (samples) => {
  const values = samples.toSorted((a, b) => a - b);
  const p = (quantile) =>
    Math.round(
      values[Math.max(0, Math.ceil(values.length * quantile) - 1)] ?? 0,
    );
  return { samples: values.length, p50: p(0.5), p95: p(0.95), p99: p(0.99) };
};

async function readPool() {
  if (poolMode === "legacy-direct") return null;
  try {
    const state = JSON.parse(await readFile(config.poolMetrics, "utf8"));
    const age = Date.now() - Date.parse(state.timestamp);
    if (!Number.isFinite(age) || age < 0 || age > 20_000 || !state.pgbouncer)
      return null;
    const { cl_waiting, maxwait } = state.pgbouncer;
    if (
      ![cl_waiting, maxwait].every(
        (value) => Number.isInteger(value) && value >= 0,
      )
    )
      return null;
    return { cl_waiting, maxwait, sampleTimestamp: state.timestamp };
  } catch {
    return null;
  }
}

async function loadStage(concurrency) {
  const start = performance.now();
  const stopAt = start + seconds * 1000;
  const reads = [],
    enqueues = [],
    documents = [],
    failures = {},
    pool = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const metrics = await readPool();
      if (metrics && pool.at(-1)?.sampleTimestamp !== metrics.sampleTimestamp)
        pool.push(metrics);
      await delay(2_000, undefined, { ref: false });
    }
  })();
  const recordFailure = (error) => {
    const code =
      error instanceof Error && /^[A-Z][A-Z0-9_]{1,48}$/.test(error.message)
        ? error.message
        : "TRANSPORT_OR_TIMEOUT";
    failures[code] = (failures[code] ?? 0) + 1;
  };
  await Promise.all(
    config.actors.slice(0, concurrency).map(async (actor, slot) => {
      await delay(slot * 120);
      try {
        const warm = await call(actor, "/organizations/current");
        if (warm.value.id !== actor.organizationId)
          throw new Error("TENANT_MISMATCH");
        const began = performance.now();
        const { value, duration } = await call(
          actor,
          "/quotes/" + actor.quoteId + "/document/exports",
          "POST",
          202,
        );
        enqueues.push(duration);
        if (!idPattern.test(value.exportId))
          throw new Error("INVALID_EXPORT_ID");
        let complete = false;
        let nextCheck = 0;
        while (
          performance.now() < stopAt ||
          (!complete && performance.now() < began + 130_000)
        ) {
          if (!complete && performance.now() >= nextCheck) {
            const state = (
              await call(actor, "/document-exports/" + value.exportId)
            ).value;
            if (state.status === "FAILED") throw new Error("EXPORT_FAILED");
            if (state.status === "COMPLETED") {
              if (
                typeof state.download?.url !== "string" ||
                !state.download.url
              )
                throw new Error("EXPORT_DOWNLOAD_MISSING");
              complete = true;
              documents.push(performance.now() - began);
            }
            nextCheck = performance.now() + 2_000;
          }
          if (performance.now() < stopAt) {
            const read = await call(actor, "/organizations/current");
            if (read.value.id !== actor.organizationId)
              throw new Error("TENANT_MISMATCH");
            reads.push(read.duration);
          }
          await delay(1_250);
        }
        if (!complete) throw new Error("EXPORT_DEADLINE");
      } catch (error) {
        recordFailure(error);
      }
    }),
  );
  sampling = false;
  await Promise.race([sampler, delay(100)]);
  let consecutiveWaits = 0;
  let saturated = false;
  for (const sample of pool) {
    consecutiveWaits =
      sample.cl_waiting > 0 && sample.maxwait >= 2 ? consecutiveWaits + 1 : 0;
    if (consecutiveWaits >= 3) saturated = true;
  }
  return {
    concurrency,
    reads: percentiles(reads),
    enqueues: percentiles(enqueues),
    exports: percentiles(documents),
    failures,
    pool: {
      samples: pool.length,
      saturated,
      maxWaitSeconds: Math.max(0, ...pool.map((sample) => sample.maxwait)),
    },
  };
}

const results = [];
for (const concurrency of stages) results.push(await loadStage(concurrency));
const issues = [];
for (const metric of results) {
  if (
    Object.keys(metric.failures).length ||
    metric.exports.samples !== metric.concurrency ||
    metric.pool.saturated
  )
    issues.push(`falha_funcional_ou_saturacao_${metric.concurrency}`);
  if (poolMode === "pgbouncer" && metric.pool.samples < minimumPoolSamples)
    issues.push(`amostras_pool_insuficientes_${metric.concurrency}`);
  if (reference) {
    const baseline = reference.results.find(
      (stage) => stage.concurrency === metric.concurrency,
    );
    if (
      !baseline ||
      baseline.exports.samples !== metric.concurrency ||
      (reference.poolMode === "pgbouncer" &&
        baseline.pool.samples < minimumPoolSamples)
    ) {
      issues.push(`comparacao_incompleta_${metric.concurrency}`);
      continue;
    }
    for (const key of ["reads", "enqueues"]) {
      if (
        !metric[key].samples ||
        !baseline[key].samples ||
        metric[key].p95 > baseline[key].p95 * 1.2
      )
        issues.push(`regressao_p95_${key}_${metric.concurrency}`);
    }
  }
}
console.log(
  JSON.stringify(
    {
      event: "orbit_staging_load",
      revision: config.expectedCommit,
      referenceRevision: reference?.revision ?? null,
      target: target.origin,
      dataset: config.dataset,
      datasetFingerprint,
      poolMode,
      seconds,
      verification: reference ? "comparison" : "baseline",
      results,
      issues,
    },
    null,
    2,
  ),
);
if (issues.length) process.exitCode = 1;
