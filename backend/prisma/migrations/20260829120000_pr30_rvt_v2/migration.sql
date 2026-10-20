-- PR-30 — RVT is a domain, not an Operation/report subtype.
-- Historical reports and artifacts are intentionally not backfilled: the old
-- data does not identify configuration/occurrence unambiguously.

CREATE TABLE rvt_configurations (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, business_unit_id UUID NOT NULL,
 customer_id UUID NOT NULL, code VARCHAR(60) NOT NULL, name VARCHAR(220) NOT NULL,
 visit_type VARCHAR(24) NOT NULL, schedule_mode VARCHAR(20) NOT NULL,
 coverage_start DATE NOT NULL, coverage_end DATE, timezone VARCHAR(80) NOT NULL,
 service_location JSONB NOT NULL, recurrence JSONB, procedure JSONB NOT NULL DEFAULT '{}',
 technical_responsible_user_id UUID, default_responsible_field_technician_id UUID,
 requires_technical_responsible BOOLEAN NOT NULL DEFAULT false,
 status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', metadata JSONB NOT NULL DEFAULT '{}',
 created_by_id UUID NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TIMESTAMPTZ(3),
 CONSTRAINT rvt_configurations_org_code_key UNIQUE(organization_id,code),
 CONSTRAINT rvt_configurations_visit_type_check CHECK(visit_type IN ('WEEKLY','SEMIANNUAL')),
 CONSTRAINT rvt_configurations_schedule_mode_check CHECK(schedule_mode IN ('RECURRING','ONE_TIME')),
 CONSTRAINT rvt_configurations_status_check CHECK(status IN ('ACTIVE','INACTIVE','COMPLETED','CANCELLED')),
 CONSTRAINT rvt_configurations_coverage_check CHECK(coverage_end IS NULL OR coverage_end>=coverage_start),
 CONSTRAINT rvt_configurations_recurring_end_check CHECK(schedule_mode='ONE_TIME' OR coverage_end IS NOT NULL),
 CONSTRAINT rvt_configurations_org_fkey FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
 CONSTRAINT rvt_configurations_bu_fkey FOREIGN KEY(business_unit_id) REFERENCES business_units(id) ON DELETE RESTRICT,
 CONSTRAINT rvt_configurations_customer_fkey FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
 CONSTRAINT rvt_configurations_rt_fkey FOREIGN KEY(technical_responsible_user_id) REFERENCES users(id) ON DELETE SET NULL,
 CONSTRAINT rvt_configurations_ft_fkey FOREIGN KEY(default_responsible_field_technician_id) REFERENCES users(id) ON DELETE SET NULL,
 CONSTRAINT rvt_configurations_created_by_fkey FOREIGN KEY(created_by_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX rvt_configurations_bu_status_idx ON rvt_configurations(organization_id,business_unit_id,status);
CREATE INDEX rvt_configurations_customer_idx ON rvt_configurations(organization_id,customer_id,status);

CREATE TABLE rvt_configuration_equipment (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, configuration_id UUID NOT NULL,
 asset_id UUID NOT NULL, added_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 removed_at TIMESTAMPTZ(3), UNIQUE(configuration_id,asset_id),
 FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
 FOREIGN KEY(configuration_id) REFERENCES rvt_configurations(id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT
);
CREATE INDEX rvt_configuration_equipment_asset_idx ON rvt_configuration_equipment(organization_id,asset_id,removed_at);

CREATE TABLE rvt_occurrences (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, business_unit_id UUID NOT NULL,
 configuration_id UUID NOT NULL, sequence_number INTEGER NOT NULL,
 scheduled_for TIMESTAMPTZ(3), local_scheduled_date DATE,
 status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED', scheduling_event_id UUID,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(configuration_id,sequence_number), UNIQUE(configuration_id,local_scheduled_date),
 UNIQUE(scheduling_event_id),
 CONSTRAINT rvt_occurrences_status_check CHECK(status IN ('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')),
 FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
 FOREIGN KEY(business_unit_id) REFERENCES business_units(id) ON DELETE RESTRICT,
 FOREIGN KEY(configuration_id) REFERENCES rvt_configurations(id) ON DELETE CASCADE,
 FOREIGN KEY(scheduling_event_id) REFERENCES scheduling_events(id) ON DELETE SET NULL
);
CREATE INDEX rvt_occurrences_queue_idx ON rvt_occurrences(organization_id,business_unit_id,status,scheduled_for);
CREATE INDEX rvt_occurrences_config_date_idx ON rvt_occurrences(organization_id,configuration_id,scheduled_for);

CREATE TABLE rvt_executions (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, business_unit_id UUID NOT NULL,
 occurrence_id UUID NOT NULL UNIQUE, operation_id UUID UNIQUE, artifact_execution_id UUID UNIQUE,
 responsible_field_technician_id UUID NOT NULL, technical_responsible_user_id UUID,
 status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS', procedure_snapshot JSONB NOT NULL,
 configuration_snapshot JSONB NOT NULL, observations JSONB NOT NULL DEFAULT '[]',
 recommendations JSONB NOT NULL DEFAULT '[]', free_text_recommendation TEXT,
 customer_acknowledgement JSONB, field_technician_signature JSONB,
 technical_responsible_signature JSONB, performed_at TIMESTAMPTZ(3),
 started_by_id UUID NOT NULL, completed_by_id UUID, started_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TIMESTAMPTZ(3), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT rvt_executions_status_check CHECK(status IN ('IN_PROGRESS','PAUSED','COMPLETED','CANCELLED')),
 FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
 FOREIGN KEY(business_unit_id) REFERENCES business_units(id) ON DELETE RESTRICT,
 FOREIGN KEY(occurrence_id) REFERENCES rvt_occurrences(id) ON DELETE RESTRICT,
 FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE SET NULL,
 FOREIGN KEY(artifact_execution_id) REFERENCES artifact_executions(id) ON DELETE SET NULL,
 FOREIGN KEY(responsible_field_technician_id) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY(technical_responsible_user_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY(started_by_id) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY(completed_by_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX rvt_executions_bu_status_idx ON rvt_executions(organization_id,business_unit_id,status);
CREATE INDEX rvt_executions_technician_idx ON rvt_executions(organization_id,responsible_field_technician_id,status);

CREATE TABLE rvt_execution_equipment (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, execution_id UUID NOT NULL,
 asset_id UUID NOT NULL, asset_snapshot JSONB NOT NULL, added_during_execution BOOLEAN NOT NULL DEFAULT false,
 added_by_id UUID NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(execution_id,asset_id), FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
 FOREIGN KEY(execution_id) REFERENCES rvt_executions(id) ON DELETE CASCADE,
 FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT,
 FOREIGN KEY(added_by_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX rvt_execution_equipment_asset_idx ON rvt_execution_equipment(organization_id,asset_id);

CREATE TABLE rvt_execution_evidence (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, execution_id UUID NOT NULL,
 storage_file_id UUID NOT NULL, asset_id UUID, kind VARCHAR(24) NOT NULL DEFAULT 'PHOTO',
 caption VARCHAR(500), uploaded_by_id UUID NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(execution_id,storage_file_id),
 CONSTRAINT rvt_evidence_kind_check CHECK(kind IN ('PHOTO','VIDEO','DOCUMENT')),
 FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
 FOREIGN KEY(execution_id) REFERENCES rvt_executions(id) ON DELETE CASCADE,
 FOREIGN KEY(storage_file_id) REFERENCES storage_files(id) ON DELETE RESTRICT,
 FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE SET NULL,
 FOREIGN KEY(uploaded_by_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX rvt_execution_evidence_idx ON rvt_execution_evidence(organization_id,execution_id,created_at);

-- Tenant + Business Unit isolation. Child policies derive BU from their parent.
ALTER TABLE rvt_configurations ENABLE ROW LEVEL SECURITY; ALTER TABLE rvt_configurations FORCE ROW LEVEL SECURITY;
CREATE POLICY rvt_configurations_isolation ON rvt_configurations FOR ALL USING(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids()))) WITH CHECK(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids())));
ALTER TABLE rvt_occurrences ENABLE ROW LEVEL SECURITY; ALTER TABLE rvt_occurrences FORCE ROW LEVEL SECURITY;
CREATE POLICY rvt_occurrences_isolation ON rvt_occurrences FOR ALL USING(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids()))) WITH CHECK(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids())));
ALTER TABLE rvt_executions ENABLE ROW LEVEL SECURITY; ALTER TABLE rvt_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY rvt_executions_isolation ON rvt_executions FOR ALL USING(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids()))) WITH CHECK(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids())));
ALTER TABLE rvt_configuration_equipment ENABLE ROW LEVEL SECURITY; ALTER TABLE rvt_configuration_equipment FORCE ROW LEVEL SECURITY;
CREATE POLICY rvt_configuration_equipment_isolation ON rvt_configuration_equipment FOR ALL USING(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND EXISTS(SELECT 1 FROM rvt_configurations c WHERE c.id=configuration_id AND c.business_unit_id=ANY(app_current_business_unit_ids())))) WITH CHECK(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND EXISTS(SELECT 1 FROM rvt_configurations c WHERE c.id=configuration_id AND c.business_unit_id=ANY(app_current_business_unit_ids()))));
ALTER TABLE rvt_execution_equipment ENABLE ROW LEVEL SECURITY; ALTER TABLE rvt_execution_equipment FORCE ROW LEVEL SECURITY;
CREATE POLICY rvt_execution_equipment_isolation ON rvt_execution_equipment FOR ALL USING(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND EXISTS(SELECT 1 FROM rvt_executions e WHERE e.id=execution_id AND e.business_unit_id=ANY(app_current_business_unit_ids())))) WITH CHECK(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND EXISTS(SELECT 1 FROM rvt_executions e WHERE e.id=execution_id AND e.business_unit_id=ANY(app_current_business_unit_ids()))));
ALTER TABLE rvt_execution_evidence ENABLE ROW LEVEL SECURITY; ALTER TABLE rvt_execution_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY rvt_execution_evidence_isolation ON rvt_execution_evidence FOR ALL USING(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND EXISTS(SELECT 1 FROM rvt_executions e WHERE e.id=execution_id AND e.business_unit_id=ANY(app_current_business_unit_ids())))) WITH CHECK(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND EXISTS(SELECT 1 FROM rvt_executions e WHERE e.id=execution_id AND e.business_unit_id=ANY(app_current_business_unit_ids()))));

GRANT SELECT,INSERT,UPDATE,DELETE ON rvt_configurations,rvt_configuration_equipment,rvt_occurrences,rvt_executions,rvt_execution_equipment,rvt_execution_evidence TO orbit_app;

UPDATE plans SET capabilities=(SELECT ARRAY(SELECT DISTINCT x FROM unnest(capabilities||ARRAY['rvt.read','rvt.manage','rvt.execute','rvt.document']::varchar[]) x)) WHERE is_active=true;
UPDATE roles SET permissions=(SELECT ARRAY(SELECT DISTINCT x FROM unnest(permissions||ARRAY['rvt.read','rvt.manage','rvt.execute','rvt.document']::varchar[]) x)) WHERE name IN ('OWNER','ADMIN');
