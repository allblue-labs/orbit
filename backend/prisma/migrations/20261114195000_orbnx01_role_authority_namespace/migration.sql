-- ORB-NX-01: preflight first, then protect new writes. Existing conflicts are
-- preserved for explicit operator review; never rename/delete/reassign roles.
CREATE FUNCTION orbit_normalize_role_key(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT left(trim(both '_' from regexp_replace(
    upper(regexp_replace(normalize(value, NFD), U&'[\0300-\036f]', '', 'g')),
    '[^A-Z0-9]+', '_', 'g')), 80)
$$;

CREATE FUNCTION orbit_reserved_role_key(value text)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT public.orbit_normalize_role_key(value) ~ '^(PLATFORM|GLOBAL|CORPORATE|NEXUS)(_|$)'
    OR public.orbit_normalize_role_key(value) = 'PLATFORMADMIN'
$$;

DO $$
DECLARE conflicts bigint;
BEGIN
  SELECT count(*) INTO conflicts FROM roles
    WHERE organization_id IS NOT NULL
      AND (orbit_reserved_role_key(key) OR orbit_reserved_role_key(name));
  RAISE NOTICE 'ORB-NX-01: % legacy tenant role namespace conflicts preserved; run documented read-only preflight', conflicts;
END
$$;

CREATE FUNCTION enforce_role_authority_namespace()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL
    AND (public.orbit_reserved_role_key(NEW.key) OR public.orbit_reserved_role_key(NEW.name))
  THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'tenant role uses reserved authority namespace'
        USING ERRCODE = '23514', CONSTRAINT = 'roles_authority_namespace';
    ELSIF NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.key IS DISTINCT FROM OLD.key OR NEW.name IS DISTINCT FROM OLD.name
    THEN
      RAISE EXCEPTION 'tenant role uses reserved authority namespace'
        USING ERRCODE = '23514', CONSTRAINT = 'roles_authority_namespace';
    END IF;
  END IF;
  -- Assignment integrity must also survive changes to the referenced role.
  IF TG_OP = 'UPDATE' AND NEW.organization_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.platform_role_assignments WHERE role_id = NEW.id)
  THEN
    RAISE EXCEPTION 'assigned global role cannot become a tenant role'
      USING ERRCODE = '23514', CONSTRAINT = 'platform_role_assignments_global_role';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER roles_authority_namespace
BEFORE INSERT OR UPDATE OF organization_id, key, name ON roles
FOR EACH ROW EXECUTE FUNCTION enforce_role_authority_namespace();
