CREATE TABLE pmoc_equipment_schedules (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  business_unit_id UUID NOT NULL REFERENCES business_units(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  cycle_id UUID NOT NULL REFERENCES pmoc_executions(id) ON DELETE CASCADE ON UPDATE CASCADE,
  coverage_id UUID NOT NULL REFERENCES pmoc_equipment_coverages(id) ON DELETE CASCADE ON UPDATE CASCADE,
  responsible_field_technician_id UUID REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  auxiliary_technician_ids UUID[] NOT NULL DEFAULT '{}',
  scheduled_for TIMESTAMPTZ(3),
  notes VARCHAR(1000),
  cancelled_at TIMESTAMPTZ(3),
  cancellation_reason VARCHAR(1000),
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cycle_id, coverage_id)
);
CREATE INDEX pmoc_equipment_schedules_assignment_idx
  ON pmoc_equipment_schedules(organization_id, responsible_field_technician_id, cancelled_at);
ALTER TABLE pmoc_equipment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmoc_equipment_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY pmoc_equipment_schedules_isolation ON pmoc_equipment_schedules FOR ALL
USING (app_is_platform_admin() OR (
  organization_id = app_current_organization_id()
  AND business_unit_id = ANY(app_current_business_unit_ids())
  AND EXISTS (SELECT 1 FROM pmoc_executions e JOIN pmoc_plans p ON p.id=e.plan_id
    JOIN pmoc_equipment_coverages c ON c.plan_id=p.id
    WHERE e.id=cycle_id AND c.id=coverage_id AND p.organization_id=pmoc_equipment_schedules.organization_id
      AND c.organization_id=p.organization_id AND p.business_unit_id=pmoc_equipment_schedules.business_unit_id)
))
WITH CHECK (app_is_platform_admin() OR (
  organization_id = app_current_organization_id()
  AND business_unit_id = ANY(app_current_business_unit_ids())
  AND EXISTS (SELECT 1 FROM pmoc_executions e JOIN pmoc_plans p ON p.id=e.plan_id
    JOIN pmoc_equipment_coverages c ON c.plan_id=p.id
    WHERE e.id=cycle_id AND c.id=coverage_id AND p.organization_id=pmoc_equipment_schedules.organization_id
      AND c.organization_id=p.organization_id AND p.business_unit_id=pmoc_equipment_schedules.business_unit_id)
));
GRANT SELECT, INSERT, UPDATE, DELETE ON pmoc_equipment_schedules TO orbit_app;
