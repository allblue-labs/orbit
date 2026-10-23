ALTER TABLE organizations ADD COLUMN data_purge_started_at TIMESTAMPTZ(3), ADD COLUMN data_purged_at TIMESTAMPTZ(3);
ALTER TABLE organization_subscriptions ADD COLUMN data_retention_ends_at TIMESTAMPTZ(3);
CREATE INDEX organization_subscriptions_retention_idx ON organization_subscriptions(data_retention_ends_at) WHERE data_retention_ends_at IS NOT NULL;
CREATE TABLE organization_legal_acceptances (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id UUID NOT NULL, terms_version VARCHAR(40) NOT NULL, privacy_version VARCHAR(40) NOT NULL,
 accepted_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(), ip_address VARCHAR(80), user_agent VARCHAR(512), documents_snapshot JSONB NOT NULL
);
CREATE INDEX organization_legal_acceptances_lookup_idx ON organization_legal_acceptances(organization_id,user_id,accepted_at);
CREATE TABLE storage_deletion_jobs (
 id UUID PRIMARY KEY, organization_id UUID NOT NULL, provider VARCHAR(40) NOT NULL, bucket VARCHAR(160) NOT NULL,
 object_key VARCHAR(1024) NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(), created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
 UNIQUE(provider,bucket,object_key)
);
CREATE INDEX storage_deletion_jobs_due_idx ON storage_deletion_jobs(next_attempt_at);
ALTER TABLE organization_legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_legal_acceptances FORCE ROW LEVEL SECURITY;
CREATE POLICY legal_acceptance_tenant ON organization_legal_acceptances USING (
 current_setting('app.is_platform_admin',true) = 'true' OR organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid
) WITH CHECK (
 current_setting('app.is_platform_admin',true) = 'true' OR organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid
);
ALTER TABLE storage_deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_deletion_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY storage_deletion_platform ON storage_deletion_jobs USING (current_setting('app.is_platform_admin',true) = 'true') WITH CHECK (current_setting('app.is_platform_admin',true) = 'true');

-- DELETE continua revogado em razões imutáveis. Exclusão de retenção possui
-- uma fronteira específica, com tenant, prazo e allowlist conferidos no banco.
CREATE OR REPLACE FUNCTION app_purge_expired_tenant_table(p_organization uuid, p_table text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE removed bigint;
BEGIN
 IF current_setting('app.is_platform_admin',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'RETENTION_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE = '42501';
 END IF;
 IF NOT (p_table = ANY(ARRAY['identity_invitations','plan_usage','plan_usage_events','integrations','customers','customer_addresses','contacts','customer_portal_identities','customer_portal_sessions','customer_portal_invitations','customer_portal_password_resets','product_categories','product_sku_sequences','products','asset_internal_code_sequences','assets','equipment_qr_identities','operations','customer_service_requests','customer_service_request_events','service_order_sequences','operation_auxiliary_technicians','checklist_templates','artifact_templates','artifact_template_versions','receipt_sequences','artifact_snapshots','artifact_executions','field_artifacts','artifact_execution_responses','artifact_execution_attachments','artifact_execution_signatures','artifact_execution_insights','storage_files','field_evidence_uploads','field_evidence','operation_cancellation_requests','artifact_manifests','checklist_executions','report_templates','reports','generated_documents','signatures','notifications','mobile_device_installations','mobile_push_deliveries','notification_preferences','push_subscriptions','ai_agents','ai_executions','scheduling_calendars','scheduling_events','scheduling_availability','audit_logs','background_jobs','specialties','member_specialties','member_certifications','teams','team_memberships','member_locations','professional_profiles','professional_credentials','user_signatures','customer_acknowledgements','mobile_offline_command_receipts','mobile_sync_changes','financial_categories','financial_entries','financial_settings','commission_policies','commission_cancellations','commission_payments','commission_payment_items','quotes','quote_items','inventory_movements','inventory_balances','domain_events','automation_rules','automation_executions','management_reports','pmoc_plans','pmoc_code_sequences','pmoc_equipment_coverages','pmoc_units','pmoc_plan_signature_links','pmoc_executions','pmoc_equipment_executions','pmoc_equipment_evidence','rvt_maintenance_types','rvt_configurations','rvt_configuration_equipment','rvt_occurrences','rvt_executions','rvt_execution_equipment','rvt_execution_evidence','operation_walk_in_commands','rvt_ad_hoc_commands','operation_materials']::text[])) THEN
   RAISE EXCEPTION 'RETENTION_TABLE_NOT_ALLOWED' USING ERRCODE = '42501';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM organizations o JOIN organization_subscriptions s ON s.organization_id = o.id
   WHERE o.id = p_organization AND o.data_purge_started_at IS NOT NULL AND o.data_purged_at IS NULL
     AND s.data_retention_ends_at IS NOT NULL AND s.data_retention_ends_at <= clock_timestamp()
 ) THEN RAISE EXCEPTION 'RETENTION_DEADLINE_NOT_REACHED' USING ERRCODE = '42501'; END IF;
 IF EXISTS (
   SELECT 1 FROM organization_subscriptions s WHERE s.organization_id = p_organization AND s.ended_at IS NULL
   AND (s.status = 'ACTIVE' AND (NOT s.cancel_at_period_end OR s.current_period_end > clock_timestamp())
     OR s.status = 'TRIALING' AND s.trial_ends_at > clock_timestamp()
     OR s.status = 'GRACE_PERIOD' AND s.grace_ends_at > clock_timestamp()
     OR s.status = 'PAST_DUE'
     OR s.status = 'PENDING_PAYMENT' AND s.provider_subscription_id IS NOT NULL)
 ) THEN RAISE EXCEPTION 'RETENTION_SUBSCRIPTION_RECOVERED' USING ERRCODE = '42501'; END IF;
 EXECUTE format('DELETE FROM public.%I WHERE organization_id = $1',p_table) USING p_organization;
 GET DIAGNOSTICS removed = ROW_COUNT;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION app_purge_expired_tenant_table(uuid,text) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbit_app') THEN
   GRANT EXECUTE ON FUNCTION app_purge_expired_tenant_table(uuid,text) TO orbit_app;
   GRANT SELECT, INSERT ON organization_legal_acceptances TO orbit_app;
   REVOKE UPDATE, DELETE ON organization_legal_acceptances FROM orbit_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON storage_deletion_jobs TO orbit_app;
 END IF;
END $$;
