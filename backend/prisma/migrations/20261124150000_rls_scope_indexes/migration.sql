BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE INDEX document_exports_unit_scope_idx
  ON public.document_exports(business_unit_id,organization_id);
CREATE INDEX organization_memberships_active_identity_idx
  ON public.organization_memberships(user_id,joined_at,id)
  WHERE status='ACTIVE' AND deleted_at IS NULL;
COMMIT;
