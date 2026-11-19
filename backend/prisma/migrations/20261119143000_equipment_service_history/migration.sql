CREATE TABLE equipment_service_history (
  operation_id UUID NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  business_unit_id UUID NOT NULL,
  completed_at TIMESTAMPTZ(3) NOT NULL,
  code VARCHAR(60) NOT NULL,
  service_order_number INTEGER,
  title VARCHAR(220) NOT NULL,
  kind VARCHAR(60) NOT NULL,
  technician_name TEXT,
  description TEXT,
  observations JSONB NOT NULL,
  PRIMARY KEY (operation_id, asset_id, completed_at)
);

CREATE INDEX equipment_service_history_scope_idx
  ON equipment_service_history (organization_id, business_unit_id, asset_id, completed_at DESC, operation_id DESC);

-- OS, PMOC and RVT all mark their canonical operation as completed. Capture the
-- visit within that transaction, using the equipment linked at that moment.
CREATE FUNCTION record_equipment_service(p_operation operations)
RETURNS void LANGUAGE sql SET search_path = pg_catalog, public AS $$
  INSERT INTO equipment_service_history (
    operation_id, asset_id, organization_id, business_unit_id, completed_at,
    code, service_order_number, title, kind, technician_name, description, observations
  )
  SELECT
    p_operation.id, equipment.asset_id, p_operation.organization_id,
    p_operation.business_unit_id, p_operation.completed_at, p_operation.code,
    p_operation.service_order_number, p_operation.title,
    CASE WHEN pmoc.id IS NOT NULL THEN 'PMOC'
         WHEN rvt.id IS NOT NULL THEN 'RVT' ELSE p_operation.kind END,
    technician.display_name, p_operation.description,
    COALESCE(notes.values, '[]'::jsonb) ||
      CASE
        WHEN pmoc.id IS NOT NULL THEN jsonb_build_array(pmoc.notes)
        WHEN rvt.id IS NOT NULL THEN COALESCE(visit_notes.values, '[]'::jsonb) ||
          jsonb_build_array(rvt.free_text_recommendation)
        ELSE '[]'::jsonb
      END
  FROM (VALUES (1)) AS anchor(n)
  LEFT JOIN pmoc_equipment_executions pmoc ON pmoc.operation_id = p_operation.id
  LEFT JOIN rvt_executions rvt ON rvt.operation_id = p_operation.id
  LEFT JOIN users technician ON technician.id = COALESCE(
    pmoc.responsible_field_technician_id, rvt.responsible_field_technician_id,
    p_operation.responsible_field_technician_id, p_operation.started_by_user_id,
    p_operation.completed_by_user_id
  )
  CROSS JOIN LATERAL (
    SELECT links.asset_id FROM operation_assets links
      WHERE links.operation_id = p_operation.id AND pmoc.id IS NULL AND rvt.id IS NULL
    UNION
    SELECT pmoc.asset_id WHERE pmoc.id IS NOT NULL
    UNION
    SELECT links.asset_id FROM rvt_execution_equipment links WHERE links.execution_id = rvt.id
    UNION
    SELECT links.asset_id FROM operation_assets links WHERE links.operation_id = p_operation.id
      AND rvt.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM rvt_execution_equipment WHERE execution_id = rvt.id
      )
  ) equipment
  JOIN assets asset ON asset.id = equipment.asset_id
    AND asset.organization_id = p_operation.organization_id
    AND asset.business_unit_id = p_operation.business_unit_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(history.details -> 'note' ORDER BY history.created_at, history.id) AS values
    FROM operation_history history
    WHERE history.operation_id = p_operation.id AND history.action = 'FIELD_NOTE_ADDED'
      AND history.created_at >= COALESCE(p_operation.started_at, p_operation.created_at)
      AND (history.details ->> 'assetId' IS NULL OR history.details ->> 'assetId' = equipment.asset_id::text)
  ) notes ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(entry.value ORDER BY entry.position) AS values
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(rvt.observations) = 'array' THEN rvt.observations ELSE '[]'::jsonb END ||
      CASE WHEN jsonb_typeof(rvt.recommendations) = 'array' THEN rvt.recommendations ELSE '[]'::jsonb END
    ) WITH ORDINALITY entry(value, position)
    WHERE entry.value ->> 'assetId' IS NULL OR entry.value ->> 'assetId' = equipment.asset_id::text
  ) visit_notes ON rvt.id IS NOT NULL
  WHERE p_operation.status = 'COMPLETED' AND p_operation.completed_at IS NOT NULL
  ON CONFLICT (operation_id, asset_id, completed_at) DO NOTHING;
$$;

-- Backfill existing completions, including legacy links to PMOC and RVT.
DO $$
DECLARE completed operations;
BEGIN
  PERFORM set_config('app.is_platform_admin', 'true', true);
  FOR completed IN SELECT * FROM operations
    WHERE status = 'COMPLETED' AND completed_at IS NOT NULL AND deleted_at IS NULL
  LOOP
    PERFORM record_equipment_service(completed);
  END LOOP;
END;
$$;

ALTER TABLE equipment_service_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_service_history FORCE ROW LEVEL SECURITY;
CREATE POLICY equipment_service_history_read ON equipment_service_history FOR SELECT
  USING (app_is_platform_admin() OR (
    organization_id = app_current_organization_id()
    AND business_unit_id = ANY(app_current_business_unit_ids())
  ));
CREATE POLICY equipment_service_history_insert ON equipment_service_history FOR INSERT
  WITH CHECK (app_is_platform_admin() OR (
    organization_id = app_current_organization_id()
    AND business_unit_id = ANY(app_current_business_unit_ids())
  ));
GRANT SELECT, INSERT ON equipment_service_history TO orbit_app;

CREATE FUNCTION capture_equipment_service_completion()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM record_equipment_service(NEW);
  RETURN NEW;
END;
$$;

CREATE TRIGGER operations_capture_equipment_service
  AFTER UPDATE OF status ON operations
  FOR EACH ROW WHEN (NEW.status = 'COMPLETED' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION capture_equipment_service_completion();
