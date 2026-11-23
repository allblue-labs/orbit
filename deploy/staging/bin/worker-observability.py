#!/usr/bin/env python3
"""Consume a recent Docker log window. Print only operational aggregates.

Exit 2 for alert conditions so a monitoring job can notify the operator.
Each invocation is a window snapshot, suitable for a textfile collector or
persistent monitoring logs. Provider/request payloads never enter the output.
"""

import argparse
import json
import sqlite3
import time
import sys
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


def collect(lines):
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
    for role in ("worker", "documents"):
        snapshot = snapshots.get(role)
        if not snapshot:
            alerts.append({"reason": "worker_snapshot_missing", "role": role})
            continue
        for queue in snapshot["queues"]:
            if queue["queue"] not in QUEUES:
                continue
            queues.append(
                {
                    key: queue[key]
                    for key in ("queue", "ready", "running", "dead", "oldest_ready_ms")
                }
            )
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

    return {
        "event": "orbit_worker_monitor",
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
    args = parser.parse_args()
    record = collect(sys.stdin)
    if args.history:
        save_snapshot(args.history, record)
    print(json.dumps(record))
    sys.exit(2 if record["alerts"] else 0)
