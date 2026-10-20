# Mobile Field Operation Execution

## Authority map

| Field action   | Existing authority                                    | Mobile contract                      |
| -------------- | ----------------------------------------------------- | ------------------------------------ |
| Prepare/resume | `Operation`, assignments, checklist snapshots         | execution preparation                |
| Start/complete | `OperationStateMachine` + transactional domain events | semantic commands                    |
| Checklist      | `ChecklistExecution.templateSnapshot`                 | OCC checklist update                 |
| Note           | `OperationHistory`                                    | add-note command and public timeline |
| Material       | Inventory ledger and atomic balance update            | register-material command            |
| Equipment QR   | Equipment QR resolver/preparation                     | reference only; scan never starts    |

The Mobile layer owns no state machine and persists no parallel execution.
PMOC and RVT remain separate execution domains.

## Endpoints

- `GET /api/v1/mobile/field/operations/:id/execution-preparation`
- `POST /api/v1/mobile/field/operations/:id/commands/start`
- `POST /api/v1/mobile/field/operations/:id/commands/complete`
- `POST /api/v1/mobile/field/operations/:id/notes`
- `PUT /api/v1/mobile/field/operations/:id/checklists/:checklistId`
- `POST /api/v1/mobile/field/operations/:id/materials`
- `GET /api/v1/mobile/field/operations/:id/timeline`

Preparation is an allowlisted snapshot containing operational customer context,
equipment, assignments, checklist snapshots, policies, current transitions,
server-side actions, eligibility, and an OCC version. It never exposes Prisma,
template administration, financial values, blobs, or signatures.

## State, OCC and idempotency

The Operation state machine is the only transition authority. `updatedAt` is
the opaque Operation version and checklist `updatedAt` is its independent OCC
version. A stale token returns HTTP 409 without writing.

Start and Complete acquire a transaction advisory lock, verify active Field
Technician profile, assignment, BU membership and expected version, then update
the Operation with compare-and-swap. The idempotency receipt is appended to the
Operation timeline in the same transaction. Scope is organization, actor,
command type and idempotency key. A payload mismatch returns 409. A committed
command replay returns the current result with `idempotentReplay=true`.

`startedBy/startedAt` are written only on the first effective start and survive
responsible replacement. `completedBy/completedAt` record the effective
completion actor. PDF generation is never performed by the command.

## Checklist, notes and timeline

Checklist answers are checked against immutable `templateSnapshot.items`.
Unknown IDs and missing required answers are rejected. Updates serialize per
checklist and compare its version, preventing silent last-write-wins.

Notes are categorized as internal or customer-visible and stored in the
operational timeline. The public timeline returns safe metadata and a resolved
message, never the note body. It uses a versioned opaque cursor ordered by
`createdAt DESC, id DESC`.

## Materials

Material registration delegates to Inventory. The inventory balance update,
ledger movement, audit and Operation timeline entry commit in one RLS
transaction. `commandId` becomes the Inventory source identity, so a retry
cannot decrement stock twice. Payload mismatch and insufficient stock return
409; negative stock remains impossible. The policy is disabled unless the
Operation is active and `inventory.manage` is present.

## Security and future offline

Every read/write uses `RlsTransaction` under the authenticated tenant and BU
scope. Active assignment never grants permission. Responsible and auxiliary
technicians both need an active FIELD_TECHNICIAN profile plus the applicable
capability. RT-only and Owner-without-professional-policy fail closed.

Commands already carry `commandId`, `idempotencyKey`, `expectedVersion`, and
`occurredAt`, making them replay-friendly for a future offline protocol without
implementing synchronization in this PR. Evidence policy explicitly rejects
base64 and leaves upload to the Media Pipeline PR.

Preparation uses two bounded RLS reads (aggregate plus field-profile check),
with nested relations loaded in one aggregate query and no per-item query.
