-- PR-30.1 — ad-hoc idempotency and one Scheduling projection per occurrence.
CREATE UNIQUE INDEX scheduling_events_rvt_occurrence_active_key
  ON scheduling_events(source_entity_id)
  WHERE source_module='RVT' AND source_entity_type='RVT_OCCURRENCE' AND deleted_at IS NULL;

CREATE TABLE rvt_ad_hoc_commands (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, business_unit_id UUID NOT NULL,
 actor_id UUID NOT NULL, idempotency_key VARCHAR(160) NOT NULL, payload_hash CHAR(64) NOT NULL,
 configuration_id UUID NOT NULL, occurrence_id UUID NOT NULL, execution_id UUID NOT NULL,
 operation_id UUID NOT NULL, customer_id UUID NOT NULL, asset_id UUID,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(organization_id,actor_id,idempotency_key),
 FOREIGN KEY(organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
 FOREIGN KEY(business_unit_id) REFERENCES business_units(id) ON DELETE RESTRICT,
 FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE RESTRICT,
 FOREIGN KEY(configuration_id) REFERENCES rvt_configurations(id) ON DELETE RESTRICT,
 FOREIGN KEY(occurrence_id) REFERENCES rvt_occurrences(id) ON DELETE RESTRICT,
 FOREIGN KEY(execution_id) REFERENCES rvt_executions(id) ON DELETE RESTRICT,
 FOREIGN KEY(operation_id) REFERENCES operations(id) ON DELETE RESTRICT,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
 FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE RESTRICT
);
CREATE INDEX rvt_ad_hoc_commands_lookup_idx ON rvt_ad_hoc_commands(organization_id,business_unit_id,created_at);
ALTER TABLE rvt_ad_hoc_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE rvt_ad_hoc_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY rvt_ad_hoc_commands_isolation ON rvt_ad_hoc_commands FOR ALL
USING(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids())))
WITH CHECK(app_is_platform_admin() OR (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids())));
GRANT SELECT,INSERT,UPDATE,DELETE ON rvt_ad_hoc_commands TO orbit_app;
