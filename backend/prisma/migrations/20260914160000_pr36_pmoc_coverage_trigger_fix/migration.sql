-- A trigger function that references NEW/OLD records from different tables is
-- unsafe in PL/pgSQL: its cached expression plan can retain the first row type
-- and later resolve a valid field from the other table as missing. Keep one
-- function per row type while preserving the deferred, commit-time invariant.

DROP TRIGGER IF EXISTS pmoc_active_plan_requires_coverage ON pmoc_plans;
DROP TRIGGER IF EXISTS pmoc_active_coverage_removal_guard ON pmoc_equipment_coverages;
DROP FUNCTION IF EXISTS app_assert_active_pmoc_has_coverage();

CREATE FUNCTION app_assert_pmoc_plan_has_coverage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ACTIVE'
     AND NEW.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM pmoc_equipment_coverages c
        WHERE c.organization_id = NEW.organization_id
          AND c.plan_id = NEW.id
          AND c.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'ACTIVE PMOC requires equipment coverage'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION app_assert_pmoc_coverage_preserves_active_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate the old owner after a delete, soft delete, or plan move.
  IF TG_OP IN ('DELETE', 'UPDATE')
     AND EXISTS (
       SELECT 1
         FROM pmoc_plans p
        WHERE p.organization_id = OLD.organization_id
          AND p.id = OLD.plan_id
          AND p.status = 'ACTIVE'
          AND p.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM pmoc_equipment_coverages c
             WHERE c.organization_id = p.organization_id
               AND c.plan_id = p.id
               AND c.deleted_at IS NULL
          )
     ) THEN
    RAISE EXCEPTION 'ACTIVE PMOC requires equipment coverage'
      USING ERRCODE = '23514';
  END IF;

  -- A move can also target an already-active plan. Validate that target using
  -- the new row type, independently from the old-plan check above.
  IF TG_OP = 'UPDATE'
     AND (OLD.organization_id, OLD.plan_id)
         IS DISTINCT FROM (NEW.organization_id, NEW.plan_id)
     AND EXISTS (
       SELECT 1
         FROM pmoc_plans p
        WHERE p.organization_id = NEW.organization_id
          AND p.id = NEW.plan_id
          AND p.status = 'ACTIVE'
          AND p.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
              FROM pmoc_equipment_coverages c
             WHERE c.organization_id = p.organization_id
               AND c.plan_id = p.id
               AND c.deleted_at IS NULL
          )
     ) THEN
    RAISE EXCEPTION 'ACTIVE PMOC requires equipment coverage'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_assert_pmoc_plan_has_coverage() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_assert_pmoc_coverage_preserves_active_plan() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER pmoc_active_plan_requires_coverage
AFTER INSERT OR UPDATE OF status, deleted_at ON pmoc_plans
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_assert_pmoc_plan_has_coverage();

CREATE CONSTRAINT TRIGGER pmoc_active_coverage_removal_guard
AFTER DELETE OR UPDATE OF deleted_at, plan_id, organization_id
ON pmoc_equipment_coverages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_assert_pmoc_coverage_preserves_active_plan();
