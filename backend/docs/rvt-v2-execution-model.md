# RVT V2 — Configuration, Occurrence and Execution

## Stage 0: model map

| Previous concept | Previous semantics | Problem | V2 destination |
|---|---|---|---|
| Artifact type `RELATORIO_VISITA` | Generic document template | No visit lifecycle | Remains only the RVT rendering template |
| Generic `Report` / Reports center | Created and listed documents | A document was treated as the domain | Reports only lists/previews/downloads legacy and issued artifacts |
| Generic `Operation` | Work item and assignment | Could be mistaken for the visit itself | Optional 1:1 operational projection created at execution start |
| ArtifactExecution | Frozen executable document | Could be created without an RVT fact | Created idempotently only from completed `RvtExecution` |
| SchedulingEvent | Generic calendar item | Competing scheduling authorities | `RvtOccurrence` is authoritative; event is an optional projection |
| Customer `address` JSON | Customer master address | Visit location needs historical context | Reused as input and frozen in configuration/execution snapshots |
| Asset | Registered equipment | RVT can cover several assets | Referenced by configuration and snapshotted per execution |
| Artifact signature policy `RVT` | Allowed Field Technician/RT signatures | No RVT execution signature boundary | Immutable signature snapshots at completion |

No legacy row is rewritten. Existing RVT reports/artifacts remain accessible and
immutable. A backfill would invent recurrence, occurrence or equipment when old
data lacks those facts, so the migration deliberately preserves them as legacy.

## Canonical model

`RvtConfiguration → RvtOccurrence → RvtExecution → ArtifactExecution → preview/PDF`.

- Configuration is administrative. It owns customer, Business Unit, service
  location, visit type, schedule mode, coverage, procedure, default staff and
  equipment links. It never creates a document.
- Occurrence is the planned visit. Its sequence is unique inside one
  configuration (`001`, `002`, ...). `scheduledFor` is an instant; its local
  civil date is persisted separately under the configuration IANA timezone.
- Execution is the visit that actually happened. A database unique constraint
  permits only one per occurrence. It freezes configuration, procedure and each
  equipment record and can contain many equipment items.
- Artifact identity is independent: `RVT-{configuration code}-{occurrence
  sequence}` is the document code in the current implementation. Occurrence
  sequence is not a globally unique document number.

`WEEKLY` and `SEMIANNUAL` are visit types. `RECURRING` and `ONE_TIME` are
schedule modes. An ad-hoc visit is normalized to one one-time configuration,
occurrence `001`, and its execution. Completion never creates `002`.

## Time, reconciliation and scheduling

Occurrence generation uses IANA timezone functions from Scheduling, retaining
09:00 local across DST. Weekly means seven civil days. Semiannual means six
calendar months anchored on the original date, clamping month end without
drift. Due state (`UPCOMING`, `DUE_TODAY`, `OVERDUE`) is derived by the backend.

The occurrence is the pre-execution scheduling authority. An Operation is
created only at start, under an advisory lock, and records `source=RVT` plus the
occurrence ID. Configuration edits must reconcile only future `SCHEDULED`,
untouched occurrences; completed/cancelled/started rows and artifacts are never
rewritten. The initial PR schema and constraints make this reconciliation safe;
the update command remains intentionally closed until its diff/audit contract
is implemented.

## People, procedure, equipment and signatures

The authenticated actor is never accepted as an arbitrary `executedByUserId`.
The selected responsible person must be an active `FIELD_TECHNICIAN` in the BU.
Auxiliaries reuse `OperationAuxiliaryTechnician`; assignment grants no role or
capability and creates no signature. The RT is a separate
`TECHNICAL_RESPONSIBLE`; a dual-role person produces two semantically distinct
snapshots when both blocks are required.

The procedure is frozen at start and keeps available/selected/results metadata
without interpreting field rules. Existing equipment is scope-checked. The
contextual registration command creates a valid normal Asset for the same
customer and BU, attaches it to the visit and configuration, and audits it;
`assets.manage` is not granted or required. Evidence reuses `StorageFile`, is
owned by the execution and is limited to 20 files of at most 20 MB each.

Customer acknowledgement is optional, captured for that execution only, and
never updates the Customer master. Field Technician signature is mandatory at
completion. RT signature/credential is mandatory only when configuration policy
requires it. All are immutable snapshots.

## Completion, Artifact and concurrency

Start, complete and artifact creation use transaction-scoped advisory locks;
unique occurrence/operation/artifact constraints are the final defense. A retry
returns the existing semantic result. Completion freezes signatures and closes
execution, occurrence and Operation in one short transaction. Artifact creation
uses the active `RELATORIO_VISITA` template and writes an Artifact Snapshot plus
the RVT document snapshot. Rendering is queued after the domain transaction and
is idempotent through the existing rendering engine.

## Authorization and isolation

Capabilities are `rvt.read`, `rvt.manage`, `rvt.execute`, and `rvt.document`.
Contextual equipment registration is reachable only through a valid in-progress
execution. Every table has tenant and BU-aware `ENABLE/FORCE RLS`; child tables
derive BU from their parent. Cross-tenant and cross-BU foreign references are
also checked by commands. The migration grants only table DML to `orbit_app`.

## API v1

The native API prefix/versioning exposes `/api/v1/rvt`: configurations,
occurrences/preparation/start, ad-hoc execution, execution updates, equipment,
evidence, customer acknowledgement, completion, artifact and queued render.
Read Models expose `allowedActions` and machine-readable eligibility blockers
for identical Web/Flutter behavior. Public structures never expose Prisma rows.

## PR-30.1 closure: reconciliation and Scheduling

Configuration updates take a transaction-scoped advisory lock. The server
regenerates the desired civil-date set, but reconciles only future
`SCHEDULED` occurrences without an execution. Completed, cancelled, started,
executed or documented occurrences are immutable. Removed future occurrences
are lifecycle-cancelled, never deleted; historical sequences are never
renumbered, and newly required dates receive monotonically increasing sequence
numbers. Repeating the same update produces zero effects.

Every occurrence creates exactly one `SchedulingEvent` with
`sourceModule=RVT`, `sourceEntityType=RVT_OCCURRENCE`; a partial unique index is
the final concurrency defense. Reconciliation moves or cancels that projection.
The later Operation inherits the occurrence context and assignment and creates
no second calendar event.

## Transactional ad-hoc and contextual registration

`POST /api/v1/rvt/ad-hoc/executions` requires `Idempotency-Key` (8–160 safe
characters), scoped by organization + actor + command key. Its SHA-256 payload
hash is persisted in `rvt_ad_hoc_commands`. Same key and same canonical payload
returns the original execution; a materially different payload returns conflict.
An advisory lock plus the unique index serialize concurrent retries.

One short RLS transaction creates the constrained Customer/contact when needed,
optional normal Asset, `ONE_TIME` configuration, occurrence `001`, Scheduling
projection, Operation, execution snapshots, audit and idempotency result. The
contextual Customer accepts only identity/contact/address fields and the Asset
only minimum equipment fields. Neither command grants or requires
`customers.manage`/`assets.manage`. Injected PostgreSQL faults before occurrence
and before execution prove that Customer and every intermediate row roll back.

## Public timeline and validation proof

`GET /api/v1/rvt/configurations/:id/timeline` is cursor-paginated and maps
tenant/BU-scoped Audit facts into business events. It publishes configuration,
reconciliation, execution, equipment, customer acknowledgement, completion and
Artifact facts without locks, retries or SQL noise.

The dedicated `test/rvt.e2e-spec.ts` proves weekly/semiannual generation,
Recife/New York DST, Scheduling uniqueness, idempotent future reconciliation,
five independent four-request start races, five independent four-request ad-hoc
races, contextual Customer/Equipment, mismatch conflict, optional customer
signature, real PDF bytes/hash, tenant isolation, timeline, rollback faults and
consolidated SQL integrity. The application uses `orbit_app`; administrative
Prisma is restricted to fixtures and independent assertions.

## Known legacy and follow-up boundary

Historical generic RVT artifacts remain served by Reports. They are not counted
as new completed visits and are not regenerated. No legacy row is creatively
backfilled into Configuration/Occurrence/Execution.
