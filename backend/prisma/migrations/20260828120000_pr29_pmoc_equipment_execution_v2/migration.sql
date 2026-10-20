-- PR-29 — PMOC configuration and physical execution per equipment.
-- Existing pmoc_executions are preserved and become the cycle aggregate.

ALTER TABLE pmoc_plans
  ADD COLUMN technical_responsible_user_id UUID,
  ADD COLUMN service_location JSONB,
  ADD COLUMN scope JSONB,
  ADD COLUMN service_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN procedure JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN scheduling_paused BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN review_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE pmoc_plans ADD CONSTRAINT pmoc_plans_technical_responsible_user_id_fkey
  FOREIGN KEY (technical_responsible_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill only when the old reference is unambiguously eligible under PR-27.
UPDATE pmoc_plans p SET technical_responsible_user_id = p.technician_user_id
WHERE p.technician_user_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM professional_profiles pp
  WHERE pp.organization_id=p.organization_id AND pp.user_id=p.technician_user_id
    AND pp.active AND pp.technical_responsible_enabled
);

ALTER TABLE pmoc_executions ADD COLUMN sequence_number INTEGER;
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY plan_id ORDER BY due_on, created_at, id)::integer AS sequence_number
  FROM pmoc_executions
)
UPDATE pmoc_executions e SET sequence_number=n.sequence_number FROM numbered n WHERE n.id=e.id;
ALTER TABLE pmoc_executions ALTER COLUMN sequence_number SET NOT NULL;
ALTER TABLE pmoc_executions ALTER COLUMN sequence_number SET DEFAULT 1;
CREATE UNIQUE INDEX pmoc_executions_plan_sequence_key ON pmoc_executions(plan_id, sequence_number);

CREATE TABLE pmoc_equipment_executions (
  id UUID NOT NULL,
  organization_id UUID NOT NULL,
  business_unit_id UUID NOT NULL,
  cycle_id UUID NOT NULL,
  coverage_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  operation_id UUID,
  artifact_execution_id UUID,
  responsible_field_technician_id UUID NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'IN_PROGRESS',
  performed_at TIMESTAMPTZ(3),
  procedure_snapshot JSONB NOT NULL,
  technical_responsible_snapshot JSONB NOT NULL,
  notes VARCHAR(1000),
  started_by_id UUID NOT NULL,
  completed_by_id UUID,
  started_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pmoc_equipment_executions_pkey PRIMARY KEY (id),
  CONSTRAINT pmoc_equipment_executions_cycle_coverage_key UNIQUE(cycle_id, coverage_id),
  CONSTRAINT pmoc_equipment_executions_operation_key UNIQUE(operation_id),
  CONSTRAINT pmoc_equipment_executions_artifact_key UNIQUE(artifact_execution_id),
  CONSTRAINT pmoc_equipment_executions_status_check CHECK (status IN ('IN_PROGRESS','COMPLETED','CANCELLED'))
);

ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_organization_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_business_unit_fkey FOREIGN KEY (business_unit_id) REFERENCES business_units(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_cycle_fkey FOREIGN KEY (cycle_id) REFERENCES pmoc_executions(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_coverage_fkey FOREIGN KEY (coverage_id) REFERENCES pmoc_equipment_coverages(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_asset_fkey FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_operation_fkey FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_artifact_fkey FOREIGN KEY (artifact_execution_id) REFERENCES artifact_executions(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_responsible_fkey FOREIGN KEY (responsible_field_technician_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_started_by_fkey FOREIGN KEY (started_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_executions ADD CONSTRAINT pmoc_equipment_executions_completed_by_fkey FOREIGN KEY (completed_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX pmoc_equipment_executions_cycle_status_idx ON pmoc_equipment_executions(organization_id,cycle_id,status);
CREATE INDEX pmoc_equipment_executions_technician_status_idx ON pmoc_equipment_executions(organization_id,responsible_field_technician_id,status);

CREATE TABLE pmoc_equipment_evidence (
  id UUID NOT NULL,
  organization_id UUID NOT NULL,
  equipment_execution_id UUID NOT NULL,
  storage_file_id UUID NOT NULL,
  kind VARCHAR(24) NOT NULL DEFAULT 'PHOTO',
  caption VARCHAR(500),
  uploaded_by_id UUID NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pmoc_equipment_evidence_pkey PRIMARY KEY(id),
  CONSTRAINT pmoc_equipment_evidence_execution_file_key UNIQUE(equipment_execution_id,storage_file_id),
  CONSTRAINT pmoc_equipment_evidence_kind_check CHECK (kind IN ('PHOTO','VIDEO','DOCUMENT'))
);
ALTER TABLE pmoc_equipment_evidence ADD CONSTRAINT pmoc_equipment_evidence_organization_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_evidence ADD CONSTRAINT pmoc_equipment_evidence_execution_fkey FOREIGN KEY (equipment_execution_id) REFERENCES pmoc_equipment_executions(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_evidence ADD CONSTRAINT pmoc_equipment_evidence_storage_fkey FOREIGN KEY (storage_file_id) REFERENCES storage_files(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE pmoc_equipment_evidence ADD CONSTRAINT pmoc_equipment_evidence_uploaded_by_fkey FOREIGN KEY (uploaded_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX pmoc_equipment_evidence_execution_idx ON pmoc_equipment_evidence(organization_id,equipment_execution_id,created_at);

ALTER TABLE pmoc_equipment_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmoc_equipment_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY pmoc_equipment_executions_isolation ON pmoc_equipment_executions FOR ALL
USING (app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids())))
WITH CHECK (app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids())));

ALTER TABLE pmoc_equipment_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmoc_equipment_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY pmoc_equipment_evidence_isolation ON pmoc_equipment_evidence FOR ALL
USING (app_is_platform_admin() OR (organization_id=app_current_organization_id() AND EXISTS (
  SELECT 1 FROM pmoc_equipment_executions e WHERE e.id=pmoc_equipment_evidence.equipment_execution_id AND e.organization_id=pmoc_equipment_evidence.organization_id AND e.business_unit_id=ANY(app_current_business_unit_ids())
)))
WITH CHECK (app_is_platform_admin() OR (organization_id=app_current_organization_id() AND EXISTS (
  SELECT 1 FROM pmoc_equipment_executions e WHERE e.id=pmoc_equipment_evidence.equipment_execution_id AND e.organization_id=pmoc_equipment_evidence.organization_id AND e.business_unit_id=ANY(app_current_business_unit_ids())
)));

GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE pmoc_equipment_executions,pmoc_equipment_evidence TO orbit_app;

-- Legacy cycle-level operation/artifact links are intentionally retained.
-- They are not copied to equipment executions because the target equipment is
-- ambiguous for plans that cover more than one asset.
