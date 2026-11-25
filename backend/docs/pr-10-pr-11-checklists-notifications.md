# PR-10 / PR-11 — Checklists and Notifications

## Checklist lifecycle

Checklist templates are versioned by `organizationId + key`. Changing the key
or item structure creates a new immutable version; metadata-only changes update
the current version. An execution stores the template version and a complete
JSON snapshot, so historical operations never change when a template evolves.

Supported item types are `BOOLEAN`, `TEXT`, `NUMBER`, `SELECT`, `PHOTO` and
`SIGNATURE`. Answers are validated against the snapshot. Completion requires
all required items and writes an event to the operation history.

Main routes:

- `GET/POST /checklist-templates`
- `GET/PATCH/DELETE /checklist-templates/:id`
- `POST /operations/:operationId/checklists`
- `GET /checklist-executions`
- `PATCH /checklist-executions/:id/answers`
- `POST /checklist-executions/:id/complete`
- `POST /checklist-executions/:id/cancel`

## Notifications

Each notification has an inbox row plus one delivery row per effective channel.
The effective channels honor the recipient preference and always retain
`IN_APP`, ensuring that disabling an external provider cannot lose the event.

Channels:

- `IN_APP`: durable database inbox.
- `REALTIME`: compatibility alias of `IN_APP`, retired by production PR-10.
- `EMAIL`: Amazon SES through the shared `EmailService`.
- `PUSH`: standards-based Web Push through VAPID.

The legacy Socket.IO gateway has been removed. Web and mobile use the authenticated
HTTP inbox; mobile additionally uses FCM for native notifications. Session, current
membership/role and tenant are resolved on every HTTP request. Read receipts live
in PostgreSQL and are shared across replicas. Historical pending REALTIME deliveries
are marked SKIPPED with provider `realtime-retired`, never falsely acknowledged.

Main routes:

- `GET /notifications`
- `GET /notifications/:id`
- `POST /notifications`
- `POST /notifications/:id/dispatch`
- `PATCH /notifications/:id/read`
- `PATCH /notifications/read-all`
- `GET/PATCH /notifications/preferences`
- `POST/DELETE /notifications/push-subscriptions`

Future `scheduledAt` notifications remain `PENDING`; the deployment scheduler
must call the idempotent dispatch route when they are due. Delivery attempts,
provider identifiers and errors remain auditable. SES failures produce `FAILED`;
missing SES configuration prevents production startup. Email is `SKIPPED` only
under `NODE_ENV=test`. VAPID that is not configured also produces `SKIPPED`.

## Configuration

Email uses `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` and
`AWS_SES_FROM_EMAIL`; temporary credentials also use `AWS_SESSION_TOKEN`.
See `amazon-ses.md` for setup and least-privilege permissions.

Push uses `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY`.
No Socket.IO endpoint is exposed; Nginx also rejects `/socket.io`.

## Isolation

Checklist templates are organization-scoped and executions inherit the
business-unit scope. Notification inbox rows are recipient-private; management
permissions allow creation and dispatch. Preferences and push subscriptions
are accessible only to their owning user. Delivery rows inherit recipient
scope. The migration is generated for manual application.
