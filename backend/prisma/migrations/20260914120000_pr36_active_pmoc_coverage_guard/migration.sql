-- PR-36 release invariant: an ACTIVE PMOC must cover at least one equipment.
--
-- Historical rows are never guessed or repaired here. An upgrade containing
-- operationally invalid rows stops with a safe, actionable preflight error so
-- the owner can classify and repair each plan before retrying the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pmoc_plans p
     WHERE p.status = 'ACTIVE'
       AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM pmoc_equipment_coverages c
          WHERE c.organization_id = p.organization_id
            AND c.plan_id = p.id
            AND c.deleted_at IS NULL
       )
  ) THEN
    RAISE EXCEPTION
      'PR36_PMOC_PREFLIGHT_FAILED: ACTIVE PMOC without equipment coverage';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_assert_active_pmoc_has_coverage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_plan_id uuid;
  candidate_organization_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'pmoc_plans' THEN
    candidate_plan_id := NEW.id;
    candidate_organization_id := NEW.organization_id;
  ELSIF TG_OP = 'DELETE' THEN
    candidate_plan_id := OLD.plan_id;
    candidate_organization_id := OLD.organization_id;
  ELSE
    candidate_plan_id := NEW.plan_id;
    candidate_organization_id := NEW.organization_id;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pmoc_plans p
     WHERE p.organization_id = candidate_organization_id
       AND p.id = candidate_plan_id
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

  -- A coverage cannot normally move between plans, but fail closed if an
  -- administrative correction ever changes plan_id.
  IF TG_TABLE_NAME = 'pmoc_equipment_coverages'
     AND TG_OP = 'UPDATE'
     AND OLD.plan_id IS DISTINCT FROM NEW.plan_id
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

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_assert_active_pmoc_has_coverage() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER pmoc_active_plan_requires_coverage
AFTER INSERT OR UPDATE OF status, deleted_at ON pmoc_plans
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_assert_active_pmoc_has_coverage();

CREATE CONSTRAINT TRIGGER pmoc_active_coverage_removal_guard
AFTER DELETE OR UPDATE OF deleted_at, plan_id ON pmoc_equipment_coverages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION app_assert_active_pmoc_has_coverage();
