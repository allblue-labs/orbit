/** Association-time validation. Past execution snapshots do not change when an
 * asset is legitimately moved to another customer/unit later in the same tenant.
 * The continuous tenant invariant is separately enforced by composite FKs.
 */
export const rvtGuardsSql = `
CREATE FUNCTION public.pr12_rvt_asset_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
DECLARE scope record; equipment record;
BEGIN
  IF TG_TABLE_NAME='rvt_configuration_equipment' THEN
    SELECT organization_id,business_unit_id,customer_id INTO scope FROM public.rvt_configurations WHERE id=NEW.configuration_id FOR SHARE;
  ELSE
    SELECT c.organization_id,c.business_unit_id,c.customer_id INTO scope FROM public.rvt_executions e
      JOIN public.rvt_occurrences o ON o.id=e.occurrence_id JOIN public.rvt_configurations c ON c.id=o.configuration_id
      WHERE e.id=NEW.execution_id FOR SHARE OF e,o,c;
  END IF;
  IF scope IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='RVT association scope is invalid',CONSTRAINT=TG_NAME; END IF;
  IF NEW.asset_id IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id,business_unit_id,customer_id INTO equipment FROM public.assets WHERE id=NEW.asset_id FOR SHARE;
  IF equipment IS NULL OR scope.organization_id IS DISTINCT FROM NEW.organization_id
    OR equipment.organization_id IS DISTINCT FROM NEW.organization_id
    OR equipment.business_unit_id IS DISTINCT FROM scope.business_unit_id
    OR equipment.customer_id IS DISTINCT FROM scope.customer_id THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='RVT association scope is invalid',CONSTRAINT=TG_NAME;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pr12_rvt_asset_scope() FROM PUBLIC;
CREATE TRIGGER pr12_rvt_configuration_equipment_scope BEFORE INSERT OR UPDATE OF asset_id,configuration_id,organization_id ON public.rvt_configuration_equipment FOR EACH ROW EXECUTE FUNCTION public.pr12_rvt_asset_scope();
CREATE TRIGGER pr12_rvt_execution_equipment_scope BEFORE INSERT OR UPDATE OF asset_id,execution_id,organization_id ON public.rvt_execution_equipment FOR EACH ROW EXECUTE FUNCTION public.pr12_rvt_asset_scope();
CREATE TRIGGER pr12_rvt_execution_evidence_scope BEFORE INSERT OR UPDATE OF asset_id,execution_id,organization_id ON public.rvt_execution_evidence FOR EACH ROW EXECUTE FUNCTION public.pr12_rvt_asset_scope();
CREATE FUNCTION public.pr12_rvt_occurrence_assets() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=off AS $$
DECLARE scope record; actual integer;
BEGIN
  IF cardinality(NEW.equipment_ids)=0 THEN RETURN NEW; END IF;
  SELECT organization_id,business_unit_id,customer_id INTO scope FROM public.rvt_configurations WHERE id=NEW.configuration_id FOR SHARE;
  IF scope IS NULL OR scope.organization_id IS DISTINCT FROM NEW.organization_id OR scope.business_unit_id IS DISTINCT FROM NEW.business_unit_id THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='RVT occurrence scope is invalid',CONSTRAINT=TG_NAME;
  END IF;
  PERFORM a.id FROM public.assets a WHERE a.id=ANY(NEW.equipment_ids) FOR SHARE;
  SELECT count(DISTINCT a.id) INTO actual FROM public.assets a JOIN public.rvt_configuration_equipment e ON e.asset_id=a.id
    WHERE e.configuration_id=NEW.configuration_id AND e.organization_id=NEW.organization_id
      AND a.id=ANY(NEW.equipment_ids) AND a.organization_id=NEW.organization_id
      AND a.business_unit_id=NEW.business_unit_id AND a.customer_id=scope.customer_id;
  IF actual <> cardinality(NEW.equipment_ids) THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='RVT occurrence equipment scope is invalid',CONSTRAINT=TG_NAME;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pr12_rvt_occurrence_assets() FROM PUBLIC;
CREATE TRIGGER pr12_rvt_occurrence_assets BEFORE INSERT OR UPDATE OF equipment_ids,configuration_id,organization_id,business_unit_id ON public.rvt_occurrences FOR EACH ROW EXECUTE FUNCTION public.pr12_rvt_occurrence_assets();
`;
