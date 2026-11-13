import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAudit } from "./audit-policy.mjs";

const empty = { metadata: { vulnerabilities: {} }, vulnerabilities: {} };
function fixture() {
  return {
    project: "backend",
    now: new Date("2026-11-12T00:00:00Z"),
    production: empty,
    full: {
      ...empty,
      vulnerabilities: {
        glob: {
          name: "glob",
          severity: "moderate",
          via: [{ url: "advisory" }],
          nodes: ["node_modules/glob"],
        },
      },
    },
    lock: {
      packages: { "node_modules/glob": { version: "13.0.6", dev: true } },
    },
    exceptions: [
      {
        project: "backend",
        advisory: "advisory",
        package: "glob",
        expiresOn: "2026-11-26",
        maxSeverity: "moderate",
        nodes: { "node_modules/glob": "13.0.6" },
      },
    ],
  };
}
test("only the reviewed development path and version are temporarily allowed", () => {
  assert.deepEqual(evaluateAudit(fixture()), []);
  const input = fixture();
  input.lock.packages["node_modules/glob"].version = "13.0.7";
  assert.equal(evaluateAudit(input).length, 1);
});
test("production dependencies and higher severities are never exempt", () => {
  const input = fixture();
  input.production = input.full;
  assert.equal(evaluateAudit(input).length, 1);
  input.production = empty;
  input.full.vulnerabilities.glob.severity = "high";
  assert.equal(evaluateAudit(input).length, 1);
  input.full.vulnerabilities.glob.severity = "moderate";
  input.lock.packages["node_modules/glob"].dev = false;
  assert.equal(evaluateAudit(input).length, 1);
});
test("an expired, unknown or wrong-project advisory fails the gate", () => {
  const input = fixture();
  input.now = new Date("2026-11-27T00:00:00Z");
  assert.equal(evaluateAudit(input).length, 1);
  input.now = new Date("2026-11-12T00:00:00Z");
  input.project = "frontend";
  assert.equal(evaluateAudit(input).length, 1);
  input.project = "backend";
  input.full.vulnerabilities.glob.via[0].url = "new-advisory";
  assert.equal(evaluateAudit(input).length, 1);
});
test("network failures or invalid audit results cannot become a green check", () => {
  const input = fixture();
  input.full = { error: { code: "EAI_AGAIN" } };
  assert.equal(evaluateAudit(input).length, 1);
});

test("a malformed severity exemption cannot bypass review", () => {
  const input = fixture();
  input.exceptions[0].maxSeverity = "typo";
  assert.equal(evaluateAudit(input).length, 1);
});

test("missing advisory references and cycles cannot hide an unreviewed dependency", () => {
  const input = fixture();
  input.full.vulnerabilities.glob.via = ["missing-package"];
  assert.equal(evaluateAudit(input).length, 1);
  input.full.vulnerabilities.glob.via = ["glob"];
  assert.equal(evaluateAudit(input).length, 1);
  input.full.vulnerabilities.glob.via = [];
  assert.equal(evaluateAudit(input).length, 1);
});

test("inherited advisories resolve to the same reviewed root", () => {
  const input = fixture();
  input.full.vulnerabilities.consumer = {
    name: "consumer",
    severity: "moderate",
    via: ["glob"],
    nodes: ["node_modules/consumer"],
  };
  assert.deepEqual(evaluateAudit(input), []);
  input.full.vulnerabilities.glob.nodes.push(
    "node_modules/new-consumer/node_modules/glob",
  );
  assert.equal(evaluateAudit(input).length, 1);
});
