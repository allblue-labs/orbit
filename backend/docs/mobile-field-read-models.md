# Mobile Field Read Models

## Purpose

The Mobile Field layer is an authenticated, tenant-scoped query projection. It
does not persist a parallel work queue and does not own execution rules. Its
public endpoints are:

- `GET /api/v1/mobile/field/dashboard`
- `GET /api/v1/mobile/field/work-queue`
- `GET /api/v1/mobile/field/work-items/:id`

Legacy-compatible routing also exposes the same controllers without the
`/api/v1` prefix while the API v1 migration window remains active.

## Source authorities and canonical identity

`Operation`, `PmocExecution` plus `PmocEquipmentCoverage`, and `RvtOccurrence`
are the three authorities. `SchedulingEvent` only supplies calendar projection
identity (`schedulingId`) and never creates another work item. Therefore an
Operation and its Scheduling event are represented once.

Canonical IDs are stable and namespaced:

```text
SERVICE_OPERATION:<operationId>
PMOC:<cycleId>:<equipmentId>
RVT:<occurrenceId>
```

The initial kinds are the closed allowlist `SERVICE_OPERATION`, `PMOC`, and
`RVT`. Adding a source requires an explicit mapper and contract change.

## Dashboard, queue and ordering

Dashboard returns counters plus previews bounded to five items per bucket. It
is intentionally not paginated. Work Queue uses an opaque versioned cursor,
has a maximum page size of 50, and accepts only `ALL`, `TODAY`, `OVERDUE`,
`IN_PROGRESS`, or `UPCOMING`.

Stable order is: in progress, overdue, due today, upcoming, unscheduled;
then scheduled instant and canonical ID. The next appointment is the first
non-active, non-overdue eligible item in that same ordering.

“Today” is the civil date calculated with the authoritative Business Unit
IANA timezone. PMOC `dueOn` is a database civil date and is not converted
through UTC. Overdue is derived at read time; no synthetic overdue state is
persisted.

## Authorization and data minimization

Every repository query executes inside `RlsTransaction`, carries the tenant ID,
and intersects the JWT Business Unit scope. A work item is a candidate only for
its responsible field technician or an active auxiliary assignment. Being
assigned never grants a capability: `allowedActions` is the intersection of
assignment, source state, and current permissions. Owner receives no bypass.

Customer output is allowlisted to display name, operational address, and one
primary contact; contact is omitted without `customers.read`. Fiscal, billing,
notes, margins, template schemas, blobs, and signatures are never projected.
Financial data is absent in v1 because this query layer has no narrower,
product-approved field financial contract yet. This is fail-closed.

Artifacts contain only ID, type, lifecycle status, and render availability.
Equipment is bounded and summarized; `qrAvailable` comes from the active QR
identity, while resolution remains owned by the Equipment QR module.

## PMOC and RVT

PMOC represents an executable equipment candidate/execution inside a real V2
cycle; a plan alone is never a work item. A missing technical responsible is a
blocker and prevents `EXECUTE_PMOC`. RVT represents an occurrence and its
optional execution. Ad-hoc creation is only exposed as a dashboard capability.

The navigation context provides source, cycle, occurrence, execution, and
equipment IDs without leaking Web routes. It is snapshot-friendly for the
future offline Field Package, but this PR implements no offline protocol.

## Query and cache characteristics

Projection uses at most six bounded, bulk RLS queries (Business Units,
Operations, PMOC, RVT, Customers, and RVT equipment; only one query for an
empty BU scope). It performs no per-item query. The 50-item contract test also
enforces a 128 KiB response ceiling. Responses must only be cached with tenant,
user, Business Unit and
permission context; no global queue cache is safe.

Structured operational metrics report request kind, duration, and item count,
without customer contacts, addresses, or financial values.

## Public contracts

`mobile-field.read-models.ts` is registered in `contracts-sync.manifest.json`
and copied to Next.js by the standard contracts sync. Flutter has equivalent
typed contracts. New fields must remain explicit allowlists and be additive;
Prisma entities must never cross the controller boundary.
