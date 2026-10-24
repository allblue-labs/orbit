-- Existing operational technician presets need the same mobile-only command
-- permission as new tenants. General operations.create remains unchanged.
-- Member custom_permissions are deliberately not rewritten: an explicit
-- member override continues to replace the role's permissions.
UPDATE roles
   SET permissions = array_append(permissions, 'operations.walk_in.create'::varchar(160)),
       updated_at = now()
 WHERE organization_id IS NOT NULL
   AND key = 'FIELD_TECHNICIAN'
   AND 'MOBILE' = ANY(allowed_surfaces)
   AND 'operations.status.update' = ANY(permissions)
   AND 'customers.read' = ANY(permissions)
   AND NOT ('operations.walk_in.create' = ANY(permissions));
