#!/usr/bin/env python3
"""Consume a recent Docker log window. Print only operational aggregates.

Exit 2 for alert conditions so a monitoring job can notify the operator.
Each invocation is a window snapshot, suitable for a textfile collector or
persistent monitoring logs. Provider/request payloads never enter the output.
"""

import argparse
import csv
from datetime import datetime, timezone
import json
import sqlite3
import time
import sys
import os
import tempfile
from pathlib import Path
from collections import Counter

QUEUES = {
    "artifact.render",
    "management-report.generate",
    "artifact.manifest.issued",
    "quote.status.changed",
    "automation.dispatch",
    "automation.action",
    "pmoc.due-check",
    "mobile.sync.cleanup",
    "mobile.evidence.cleanup",
    "mobile.push.delivery",
    "mobile.notification.materialize",
    "document.export",
    "document.export.cleanup",
}
FAST_QUEUES = {"mobile.push.delivery", "mobile.notification.materialize"}
PROVIDERS = {"R2", "S3", "MINIO"}
OPERATIONS = {"put", "get", "head", "delete", "sign"}
RESULTS = {"ok", "missing", "deadline", "error", "busy"}
PUSH_PROVIDERS = {"firebase-admin", "http-gateway", "disabled"}
PUSH_RESULTS = {
    "ACCEPTED_BY_PROVIDER",
    "INVALID_TOKEN",
    "TEMPORARY_FAILURE",
    "PERMANENT_FAILURE",
}


GROUPS = ("pdf", "comms", "core", "fiscal", "ai")
GROUP_BY_QUEUE = {
    **dict.fromkeys(("artifact.render", "management-report.generate", "document.export"), "pdf"),
    **dict.fromkeys(("mobile.push.delivery", "mobile.notification.materialize"), "comms"),
}


def load_pool(path):
    if path is None:
        return None
    with open(path, newline="") as stream:
        rows = [
            {key: int(row[key]) for key in ("cl_active", "cl_waiting", "sv_active", "sv_idle", "maxwait")}
            for row in csv.DictReader(stream)
            if row.get("user") in {"orbit_app", "orbit_worker", "orbit_documents"}
        ]
    return {key: sum(row[key] for row in rows) for key in ("cl_active", "cl_waiting", "sv_active", "sv_idle")} | {
        "maxwait": max((row["maxwait"] for row in rows), default=0),
    }


def collect(lines, pool=None):
    snapshots = {}
    storage = Counter()
    push = Counter()
    for line in lines:
        try:
            data = json.loads(line[line.index("{") :])
            if not isinstance(data, dict):
                continue
            if data.get("event") == "worker_queue_snapshot" and data.get("role") in {
                "worker",
                "documents",
            }:
                stamp = data.get("timestamp")
                if stamp and (datetime.now(timezone.utc) - datetime.fromisoformat(stamp.replace("Z", "+00:00"))).total_seconds() > 180:
                    continue
                snapshots[data["role"]] = data
            if (
                data.get("event") == "storage_request"
                and data.get("provider") in PROVIDERS
                and data.get("operation") in OPERATIONS
                and data.get("result") in RESULTS
            ):
                storage[data["provider"], data["operation"], data["result"]] += 1
            if (
                data.get("event") == "mobile_push_delivery"
                and data.get("provider") in PUSH_PROVIDERS
                and data.get("result") in PUSH_RESULTS
            ):
                push[data["provider"], data["result"]] += 1
        except (ValueError, TypeError):
            continue

    alerts = []
    queues = []
    groups = {group: {"pending": 0, "ready": 0, "running": 0, "dead": 0, "oldest_ready_ms": 0, "_weighted_ms": 0} for group in GROUPS}
    for role in ("worker", "documents"):
        snapshot = snapshots.get(role)
        if not snapshot:
            alerts.append({"reason": "worker_snapshot_missing", "role": role})
            continue
        for queue in snapshot.get("queues", []):
            if queue["queue"] not in QUEUES:
                continue
            group = queue.get("group") or GROUP_BY_QUEUE.get(queue["queue"], "core")
            if group not in groups:
                continue
            pending = queue.get("pending", queue["ready"])
            average = queue.get("average_ready_ms", 0)
            queues.append({
                **{key: queue[key] for key in ("queue", "ready", "running", "dead", "oldest_ready_ms")},
                "pending": pending, "group": group, "average_ready_ms": average,
            })
            target = groups[group]
            target["pending"] += pending
            for key in ("ready", "running", "dead"):
                target[key] += queue[key]
            target["oldest_ready_ms"] = max(target["oldest_ready_ms"], queue["oldest_ready_ms"])
            target["_weighted_ms"] += average * queue["ready"]
            if queue["dead"]:
                alerts.append({"reason": "dead_letters", "queue": queue["queue"]})
            limit = 60_000 if queue["queue"] in FAST_QUEUES else 300_000
            if queue["oldest_ready_ms"] >= limit:
                alerts.append({"reason": "oldest_ready_job", "queue": queue["queue"]})

    providers = []
    for provider in sorted(PROVIDERS):
        for operation in sorted(OPERATIONS):
            counts = {
                result: storage[provider, operation, result]
                for result in sorted(RESULTS)
            }
            total = sum(counts.values())
            if not total:
                continue
            providers.append({"provider": provider, "operation": operation, **counts})
            if (
                total >= 5
                and (counts["deadline"] + counts["error"] + counts["busy"]) / total
                >= 0.10
            ):
                alerts.append(
                    {
                        "reason": "storage_error_rate",
                        "provider": provider,
                        "operation": operation,
                    }
                )

    for group in groups.values():
        weighted = group.pop("_weighted_ms")
        group["average_ready_ms"] = round(weighted / group["ready"], 2) if group["ready"] else 0
    if pool and pool["cl_waiting"] > 0 and pool["maxwait"] >= 2:
        alerts.append({"reason": "pgbouncer_queue_wait", "waiting": pool["cl_waiting"]})
    return {
        "event": "orbit_worker_monitor",
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "groups": groups,
        "pgbouncer": pool,
        "queues": queues,
        "providers": providers,
        "push": [
            {"provider": provider, "result": result, "count": count}
            for (provider, result), count in sorted(push.items())
        ],
        "workers": {
            role: {key: data[key] for key in ("rssBytes", "eventLoopP95Ms")}
            for role, data in snapshots.items()
        },
        "alerts": alerts,
    }


def publish_snapshot(path, record):
    target = Path(path)
    descriptor, pending = tempfile.mkstemp(dir=target.parent, prefix=".orbit-monitor-")
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(record, stream)
        os.replace(pending, target)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def save_snapshot(path, record):
    timestamp = int(time.time())
    with sqlite3.connect(path) as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS snapshots (collected_at INTEGER PRIMARY KEY, record TEXT NOT NULL)"
        )
        db.execute(
            "INSERT OR REPLACE INTO snapshots VALUES (?, ?)",
            (timestamp, json.dumps(record)),
        )
        db.execute(
            "DELETE FROM snapshots WHERE collected_at < ?", (timestamp - 30 * 86400,)
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--history", help="SQLite path in a private persistent host directory"
    )
    parser.add_argument("--output", help="Arquivo privado de métricas atualizado atomicamente")
    parser.add_argument("--pool-csv", help="Saída CSV de SHOW POOLS coletada pela identidade orbit_stats")
    args = parser.parse_args()
    record = collect(sys.stdin, load_pool(args.pool_csv))
    if args.history:
        save_snapshot(args.history, record)
    if args.output:
        publish_snapshot(args.output, record)
    print(json.dumps(record))
    sys.exit(2 if record["alerts"] else 0)
