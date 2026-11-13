import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const severities = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export function evaluateAudit({
  project,
  full,
  production,
  lock,
  exceptions,
  now = new Date(),
}) {
  const errors = [];
  for (const report of [full, production]) {
    if (
      report?.error ||
      !report?.metadata?.vulnerabilities ||
      !report.vulnerabilities ||
      typeof report.vulnerabilities !== "object" ||
      Array.isArray(report.vulnerabilities)
    )
      return ["Audit unavailable or malformed; refusing to report success"];
  }
  if (Object.keys(production.vulnerabilities).length)
    errors.push("Production dependencies must have zero known advisories");
  // npm represents inherited advisories by package name. Every branch must
  // reach an actual advisory; missing references/cycles cannot grant an exemption.
  function validAdvisoryGraph(name, ancestors = new Set()) {
    const item = full.vulnerabilities[name];
    if (
      ancestors.has(name) ||
      !item ||
      !Array.isArray(item.via) ||
      !item.via.length
    )
      return false;
    const branch = new Set([...ancestors, name]);
    return item.via.every((via) =>
      typeof via === "string"
        ? validAdvisoryGraph(via, branch)
        : via && typeof via.url === "string" && via.url.length > 0,
    );
  }
  for (const [name, vulnerability] of Object.entries(full.vulnerabilities)) {
    if (
      !validAdvisoryGraph(name) ||
      !Array.isArray(vulnerability.nodes) ||
      !vulnerability.nodes.length
    ) {
      errors.push(`${name}: malformed advisory graph or dependency paths`);
      continue;
    }
    if (
      !Object.hasOwn(severities, vulnerability.severity) ||
      severities[vulnerability.severity] >= severities.high
    ) {
      errors.push(`${vulnerability.name}: severity not allowed`);
      continue;
    }
    for (const advisory of vulnerability.via.filter(
      (item) => typeof item === "object",
    )) {
      const exception = exceptions.find(
        (item) =>
          item.project === project &&
          item.advisory === advisory.url &&
          item.package === vulnerability.name,
      );
      if (
        !exception ||
        !Object.hasOwn(severities, exception.maxSeverity) ||
        Date.parse(`${exception.expiresOn}T23:59:59Z`) < now.getTime() ||
        !Number.isFinite(Date.parse(`${exception.expiresOn}T23:59:59Z`)) ||
        severities[vulnerability.severity] > severities[exception.maxSeverity]
      ) {
        errors.push(
          `${vulnerability.name}: missing, expired or insufficient exception (${advisory.url})`,
        );
        continue;
      }
      for (const node of vulnerability.nodes) {
        const dependency = lock.packages[node];
        if (!dependency?.dev || exception.nodes[node] !== dependency.version)
          errors.push(
            `${vulnerability.name}: unreviewed dependency path/version (${node})`,
          );
      }
    }
  }
  return errors;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const project = process.argv[2];
  if (!["backend", "frontend"].includes(project))
    throw new Error("Choose backend or frontend");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cwd = resolve(root, project);
  function audit(args) {
    const result = spawnSync("npm", ["audit", "--json", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10_000_000,
    });
    if (result.error || ![0, 1].includes(result.status))
      throw new Error("npm audit could not complete");
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error("npm audit returned invalid JSON");
    }
  }
  const full = audit(["--include=dev"]);
  const production = audit(["--omit=dev"]);
  const lock = JSON.parse(
    await readFile(resolve(cwd, "package-lock.json"), "utf8"),
  );
  const exceptions = JSON.parse(
    await readFile(new URL("./audit-exceptions.json", import.meta.url), "utf8"),
  );
  const errors = evaluateAudit({ project, full, production, lock, exceptions });
  console.log(
    JSON.stringify(
      {
        project,
        full: full.metadata?.vulnerabilities,
        production: production.metadata?.vulnerabilities,
        reviewedUntil: "2026-11-26",
        errors,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
}
