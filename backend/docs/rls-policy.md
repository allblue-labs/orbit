# Row Level Security policy

The base policies are in `prisma/migrations/20260730170000_enable_rls/migration.sql`.
Subsequent migrations extend them. The [release runbook](../../docs/release/rls-pgbouncer.md)
describes the current role grants and connection topology.

## Context contract

Every tenant database operation must execute inside a transaction populated by
`RlsTransaction`:

- `app.user_id`
- `app.organization_id`
- `app.business_unit_id`
- `app.business_unit_ids`
- `app.roles`
- `app.permissions`
- `app.is_platform_admin`

Values are transaction-local and therefore return automatically to an empty
state when a pooled connection is reused.

## Policy groups

- Shared read-only catalogs: `modules` and `pmoc_plan_name_options`.
- Authentication bootstrap: `users`, `credentials`, `mfa_factors`,
  `password_reset_tokens`, `sessions`, and `identity_invitations`.
- Organization root: `organizations`.
- Organization scoped: usage, integrations, customers, categories, templates,
  documents, signatures, and AI records.
- Required business-unit scope: assets, operations, checklist executions,
  reports, `financial_entries`, `quotes`, and both inventory tables. Money and
  stock are counted per unit, so those policies demand organization **and**
  unit — access to one branch never reveals another branch's cash or shelf. The
  inventory policy is also what forces a transfer to hold access to **both**
  ends: the destination insert passes through that unit's `WITH CHECK`.
- Optional business-unit scope: contacts, products, and notifications. A null
  unit means organization-wide.
- Organization scoped, added in PR-21: `financial_categories` and
  `financial_settings`.
- Parent inherited: operation users and history inherit the policy of their
  operation.
- Audit logs: tenant/unit scoped, SELECT and INSERT only.

Membership SELECT policies have a narrow bootstrap exception:
`user_id = app.user_id`. This lets authentication discover only the current
user's memberships before selecting an organization. Membership writes remain
strictly tenant/unit scoped.

System roles (`organization_id IS NULL`) are readable by authenticated users but
mutable only by platform administrators. Tenant roles remain isolated by
organization.

## Identity bootstrap

Identity tables enforce RLS. Login, refresh, recovery and invitation acceptance
begin with exact lookups using a normalized email, credential ID or token digest.
The new lookup routines run with a dedicated NOLOGIN owner. Further reads and
writes set the validated identity or organization inside a transaction. Team
rosters keep read access to identities associated with their organization.

Public plans are shared catalog data. Private offers and their Stripe mappings
require the tenant or platform context. The administrative catalog writer has
an explicit write policy.

## Applying

Use the Compose migrator through `DIRECT_DATABASE_URL` to apply schema changes
and reconcile grants. The API and consumers connect through PgBouncer using
restricted roles. PostgreSQL superusers and `BYPASSRLS` roles bypass policies
even when RLS is forced.
