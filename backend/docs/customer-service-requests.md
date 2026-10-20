# Customer Service Requests / Chamados (PR-34)

## Purpose and Stage 0

The audit found no Ticket, Service Request or equivalent aggregate. `Operation`
is an accepted operational commitment and therefore is not a safe substitute
for a customer intention. The final name is `CustomerServiceRequest`.

The existing reusable boundaries are: Portal Identity and its Customer-derived
scope, Asset ownership, the `RlsTransaction`, UUIDv7, AuditLog, Operation
creation/history, API v1 and semantic command conventions. Operation had no
source column, so conversion records structured provenance in `Operation.data`
and the canonical inverse relation remains
`CustomerServiceRequest.convertedOperationId`.

There was no suitable public/internal message model. The module consequently
owns an append-only `CustomerServiceRequestEvent` timeline. AuditLog remains
audit and is never used as customer communication. The Notification Engine
requires an explicit internal recipient, while the Portal has no device
registry; PR-34 records auditable domain facts but does not guess recipients or
add an email adapter. No consistency step uses a worker.

Attachments are **NO** for PR-34. MB-05 evidence is execution- and
internal-user-scoped; extending it to a Portal actor would be a new storage
security boundary, not reuse at low risk. Portal replies, chat, SLA, AI and UI
are also outside V1.

## Aggregate and ownership

`CustomerServiceRequest` stores its real author (`createdByPortalIdentityId`),
Organization, Customer, optional Asset/Business Unit, category, plain-text
subject/description, lifecycle, OCC version, assignment and optional canonical
Operation. There is no soft deletion: cancellation is a state and the history
survives.

The Portal DTO cannot contain Organization, Customer, Business Unit, status,
priority, assignment or Operation. Organization/Customer/author come from the
validated Portal session. If an Asset is supplied, the repository requires the
same Organization and Customer and derives its Business Unit. Without Asset,
Business Unit remains null until triage. A foreign or invisible Asset has 404
semantics. The customer never sets operational priority.

Public categories are deliberately broad:

- `MAINTENANCE`
- `EQUIPMENT_PROBLEM`
- `SERVICE_REQUEST`
- `DOCUMENT_REQUEST`
- `QUESTION`
- `OTHER`

A category is not an Operation kind and causes no automatic conversion.

## Lifecycle

Transitions are centralized in `CustomerServiceRequestPolicy`:

| State | Allowed next states |
| --- | --- |
| `OPEN` | `IN_TRIAGE`, `IN_PROGRESS`, `RESOLVED`, `REJECTED`, `CANCELLED` |
| `IN_TRIAGE` | `IN_PROGRESS`, `WAITING_CUSTOMER`, `RESOLVED`, `REJECTED`, `CANCELLED` |
| `IN_PROGRESS` | `WAITING_CUSTOMER`, `RESOLVED`, `REJECTED` |
| `WAITING_CUSTOMER` | `IN_PROGRESS`, `RESOLVED`, `REJECTED` |
| `RESOLVED`, `REJECTED`, `CANCELLED` | terminal |

The Portal receives PT-BR labels and server-calculated `allowedActions`. It can
cancel only in `OPEN` or `IN_TRIAGE` and only before conversion. Repeating an
already completed cancellation returns the same logical record. It cannot
delete, assign, classify, change status generically or create an Operation.

Internal commands carry `expectedVersion`. A stale version returns 409; an
advisory transaction lock plus the version check gives one deterministic
winner in a status race. Reopen is intentionally absent.

## Timeline

Events are inserted in the same transaction as their fact and ordered by
`createdAt ASC, id ASC`. Actor type/id and display-name snapshot are persisted.
Public responses and public state changes use `PORTAL` visibility. Internal
notes use `INTERNAL` visibility. PostgreSQL RLS filters Portal reads to public
events before the mapper runs; the mapper repeats the filter as defense in
depth. The runtime role has no UPDATE/DELETE policy on the events table, making
the timeline append-only.

## Conversion into an Operation

Only an internal actor with `customer_service_requests.manage`, an active plan
and valid Business Unit scope can invoke `create-operation`. The command
requires the Operation fields the request does not authoritatively provide:
Business Unit, code, kind and title; description is optional. Customer and
Asset are always copied from the request, never accepted from the command.

`OperationRepository.createWithin()` is the transaction-aware Operation
boundary. Operation, OperationHistory, outbox event, request link, state
transition, timeline and audit commit or roll back together. The Operation
stores `{source:{type:'CUSTOMER_SERVICE_REQUEST', id, code}}` in `data`.

An advisory lock serializes conversions. `convertedOperationId` is unique and
the request stores conversion key/hash. Same key and payload return the same
Operation; a mismatch or a second conversion returns 409. Conversion moves the
request to `IN_PROGRESS`. Later Operation changes do not silently rewrite the
request; resolution remains an explicit service-request command.

## API v1

| Actor | Method | Route | Semantics | Idempotency |
| --- | --- | --- | --- | --- |
| Portal | POST | `/api/v1/portal/me/service-requests` | create own request | required header |
| Portal | GET | `/api/v1/portal/me/service-requests` | own paginated list | query |
| Portal | GET | `/api/v1/portal/me/service-requests/:id` | own public detail/timeline | query |
| Portal | POST | `/api/v1/portal/me/service-requests/:id/cancel` | semantic cancellation | terminal replay |
| Internal | GET | `/api/v1/customer-service-requests` | scoped triage queue | query |
| Internal | GET | `/api/v1/customer-service-requests/:id` | internal detail/timeline | query |
| Internal | POST | `/:id/triage` | classify/link own-customer Asset and start triage | OCC |
| Internal | POST | `/:id/assign` | assign active organization member | OCC |
| Internal | POST | `/:id/status` | explicit validated transition | OCC |
| Internal | POST | `/:id/public-responses` | append customer-visible response | OCC |
| Internal | POST | `/:id/internal-notes` | append internal-only note | OCC |
| Internal | POST | `/:id/create-operation` | atomic canonical Operation | key/hash + OCC |

Lists default to page 1/limit 20, cap limit at 50 and sort stably by
`createdAt DESC, id DESC`. Each list uses one bounded relation query and one
count query (two domain queries plus the single RLS context application); no
per-row query exists. Detail is one joined query plus context application.

## Authorization and RLS

Internal access uses plan capabilities and permissions
`customer_service_requests.read` / `customer_service_requests.manage`; no new
role exists and owner wildcard remains compatible. Portal JWTs never contain
these capabilities and cannot authenticate on internal endpoints. Internal
JWTs cannot authenticate through `CustomerPortalGuard`.

Both `customer_service_requests` and `customer_service_request_events` have
`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`:

- Portal request SELECT/INSERT/cancel is bound to current Organization,
  Customer and Portal Identity.
- Internal SELECT is bound to Organization, permission and, when present,
  current Business Unit scope. A null-BU request remains visible to the
  authorized organizational triage queue.
- Internal mutation additionally requires manage permission.
- Portal event SELECT requires own parent and `visibility = 'PORTAL'`.
- Event writes validate the parent scope; no event UPDATE/DELETE policy exists.
- Constraint triggers independently validate Identity/Asset/parent
  consistency and restrict Portal UPDATE to the cancellation shape.

Missing or wrong transaction context therefore returns zero rows/denies writes.
The application runtime remains `orbit_app`, without SUPERUSER/BYPASSRLS.

## Public contracts and future boundary

Controllers return mapper-built Read Models only; neither Prisma entities nor
idempotency hashes, internal metadata, raw actor emails or audit data cross the
API. The Read Model is in the contracts manifest and is synchronized to Next.
It is plain TypeScript and can also be represented by a Flutter parser without
changing the API. PR-34 changes no production Web or Mobile UI.

A future PR may add Portal evidence only after defining signed upload,
malware/type/size validation, retention, tenant ownership and orphan cleanup
for external actors. That work must not overload MB-05 implicitly. Likewise,
Portal notifications need an explicit Portal delivery/device contract rather
than reuse of internal user recipients.
