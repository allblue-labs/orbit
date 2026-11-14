-- ORB-NX-01 read-only preflight, usable BEFORE the new migration exists.
-- Run with an authorized administrative read connection: tenant RLS would
-- deliberately hide other organizations. Never paste connection secrets.
-- This script never renames, deletes, revokes or reassigns anything.
BEGIN READ ONLY;

WITH normalized AS (
  SELECT id, organization_id, key, deleted_at,
    left(trim(both '_' from regexp_replace(upper(regexp_replace(
      normalize(key, NFD), U&'[\0300-\036f]', '', 'g')),
      '[^A-Z0-9]+', '_', 'g')), 80) AS normalized_key,
    left(trim(both '_' from regexp_replace(upper(regexp_replace(
      normalize(name, NFD), U&'[\0300-\036f]', '', 'g')),
      '[^A-Z0-9]+', '_', 'g')), 80) AS normalized_name
  FROM roles WHERE organization_id IS NOT NULL
)
SELECT n.id AS role_id, n.organization_id, n.key, n.deleted_at,
  (SELECT count(*) FROM organization_memberships m WHERE m.role_id = n.id) AS organization_bindings,
  (SELECT count(*) FROM business_unit_memberships m WHERE m.role_id = n.id) AS unit_bindings,
  (SELECT count(*) FROM identity_invitations i WHERE i.role_id = n.id) AS invitations
FROM normalized n
WHERE normalized_key ~ '^(PLATFORM|GLOBAL|CORPORATE|NEXUS)(_|$)'
  OR normalized_name ~ '^(PLATFORM|GLOBAL|CORPORATE|NEXUS)(_|$)'
  OR normalized_key = 'PLATFORMADMIN' OR normalized_name = 'PLATFORMADMIN'
ORDER BY n.organization_id, n.id;

-- Separate integrity anomalies: active assignments referencing tenant/deleted
-- roles. Report only; runtime verification excludes these grants.
SELECT a.id AS assignment_id, a.user_id, a.role_id, r.organization_id,
  r.deleted_at AS role_deleted_at
FROM platform_role_assignments a JOIN roles r ON r.id = a.role_id
WHERE a.revoked_at IS NULL AND (r.organization_id IS NOT NULL OR r.deleted_at IS NOT NULL)
ORDER BY a.id;

COMMIT;
