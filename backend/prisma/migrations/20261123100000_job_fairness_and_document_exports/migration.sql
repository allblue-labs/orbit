-- ORBIT V2 — Justiça entre organizações na fila e exportação assíncrona de documentos.
--
-- 1. Índices do claim com justiça: o worker escolhe, entre os pendentes de um
--    grupo de filas, o da organização com menos jobs rodando, respeitando um
--    teto por organização. Os índices parciais cobrem as duas contagens.
-- 2. Idempotência permanente do grupo fiscal: a mesma nota não é pedida duas
--    vezes nem depois de concluída. DEAD fica de fora para permitir reenvio.
-- 3. `document_exports`: acompanhamento das exportações assíncronas (202 +
--    arquivo no R2 + URL assinada). Sem o arquivo a exportação não tem o que
--    entregar, então `storage_file_id` remove a linha junto (CASCADE) em vez
--    de anular — anular violaria o CHECK de COMPLETED.
-- 4. Expurgo por retenção aceita `document_exports`.

CREATE INDEX "background_jobs_claim_idx"
  ON "background_jobs" ("queue", "available_at", "created_at")
  WHERE "status" = 'PENDING';

CREATE INDEX "background_jobs_running_org_idx"
  ON "background_jobs" ("queue", "organization_id")
  WHERE "status" = 'RUNNING';

CREATE INDEX "background_jobs_started_idx"
  ON "background_jobs" ("queue", "organization_id", "started_at")
  WHERE "started_at" IS NOT NULL;

CREATE UNIQUE INDEX "background_jobs_fiscal_idempotency_idx"
  ON "background_jobs" ("organization_id", "queue", "job_key")
  WHERE "queue" LIKE 'fiscal.%' AND "status" <> 'DEAD';

CREATE TABLE "document_exports" (
  "id"                 UUID PRIMARY KEY,
  "organization_id"    UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "business_unit_id"   UUID REFERENCES "business_units"("id") ON DELETE SET NULL,
  "kind"               VARCHAR(30) NOT NULL
                       CHECK ("kind" IN ('QUOTE','QUOTE_ACCEPTED','PMOC_PLAN','EQUIPMENT_QR')),
  "entity_id"          UUID NOT NULL,
  "params"             JSONB NOT NULL DEFAULT '{}',
  "status"             VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                       CHECK ("status" IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  "job_id"             UUID REFERENCES "background_jobs"("id") ON DELETE SET NULL,
  "storage_file_id"    UUID REFERENCES "storage_files"("id") ON DELETE CASCADE,
  "file_name"          VARCHAR(200),
  "content_type"       VARCHAR(80),
  "error_code"         VARCHAR(60),
  "requested_by"       UUID,
  "acceptance_link_id" UUID,
  "correlation_id"     VARCHAR(64) NOT NULL,
  "expires_at"         TIMESTAMPTZ(3) NOT NULL,
  "completed_at"       TIMESTAMPTZ(3),
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "document_exports_completed_has_file"
    CHECK ("status" <> 'COMPLETED' OR "storage_file_id" IS NOT NULL),
  CONSTRAINT "document_exports_accepted_has_link"
    CHECK ("kind" <> 'QUOTE_ACCEPTED' OR "acceptance_link_id" IS NOT NULL)
);
CREATE INDEX "document_exports_org_status_idx"
  ON "document_exports" ("organization_id", "status", "created_at");
CREATE INDEX "document_exports_expiry_idx" ON "document_exports" ("expires_at");

ALTER TABLE "document_exports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_exports" FORCE ROW LEVEL SECURITY;
CREATE POLICY "document_exports_tenant" ON "document_exports" FOR ALL
  USING (
    app_is_platform_admin() OR (
      "organization_id" = app_current_organization_id()
      AND ("business_unit_id" IS NULL
           OR "business_unit_id" = ANY(app_current_business_unit_ids()))))
  WITH CHECK (
    app_is_platform_admin() OR (
      "organization_id" = app_current_organization_id()
      AND ("business_unit_id" IS NULL
           OR "business_unit_id" = ANY(app_current_business_unit_ids()))));
GRANT SELECT, INSERT, UPDATE, DELETE ON "document_exports" TO orbit_app;

CREATE OR REPLACE FUNCTION app_purge_expired_tenant_table(p_organization uuid, p_table text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed bigint;
BEGIN
 IF current_setting('app.is_platform_admin',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'RETENTION_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE = '42501';
 END IF;
 IF NOT (p_table = ANY(ARRAY['identity_invitations','plan_usage','plan_usage_events','integrations','customers','customer_addresses','contacts','customer_portal_identities','customer_portal_sessions','customer_portal_invitations','customer_portal_password_resets','product_categories','product_sku_sequences','products','asset_internal_code_sequences','assets','equipment_qr_identities','operations','customer_service_requests','customer_service_request_events','service_order_sequences','operation_auxiliary_technicians','checklist_templates','artifact_templates','artifact_template_versions','receipt_sequences','artifact_snapshots','artifact_executions','field_artifacts','artifact_execution_responses','artifact_execution_attachments','artifact_execution_signatures','artifact_execution_insights','storage_upload_admissions','document_exports','storage_files','field_evidence_uploads','field_evidence','operation_cancellation_requests','artifact_manifests','checklist_executions','report_templates','reports','generated_documents','signatures','notifications','mobile_device_installations','mobile_push_deliveries','notification_preferences','push_subscriptions','ai_agents','ai_executions','scheduling_calendars','scheduling_events','scheduling_availability','audit_logs','background_jobs','specialties','member_specialties','member_certifications','teams','team_memberships','member_locations','professional_profiles','professional_credentials','user_signatures','customer_acknowledgements','mobile_offline_command_receipts','mobile_sync_changes','financial_categories','financial_entries','financial_settings','commission_policies','commission_cancellations','commission_payments','commission_payment_items','quotes','quote_acceptance_links','quote_items','inventory_movements','inventory_balances','domain_events','automation_rules','automation_executions','management_reports','pmoc_plans','pmoc_code_sequences','pmoc_equipment_coverages','pmoc_equipment_schedules','pmoc_units','pmoc_plan_signature_links','pmoc_executions','pmoc_equipment_executions','pmoc_equipment_evidence','rvt_maintenance_types','rvt_configurations','rvt_configuration_equipment','rvt_occurrences','rvt_executions','rvt_execution_equipment','rvt_execution_evidence','operation_walk_in_commands','rvt_ad_hoc_commands','operation_materials','product_sales']::text[])) THEN
   RAISE EXCEPTION 'RETENTION_TABLE_NOT_ALLOWED' USING ERRCODE = '42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_organization::text,0));
 IF NOT EXISTS (SELECT 1 FROM public.tenant_data_purges WHERE organization_id=p_organization
   AND status='PREPARING' AND retention_ends_at<=clock_timestamp()) THEN
   RAISE EXCEPTION 'RETENTION_CLAIM_REQUIRED' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('upload-budget:' || p_organization::text,0));
 IF EXISTS (SELECT 1 FROM public.storage_upload_admissions WHERE organization_id=p_organization AND expires_at>clock_timestamp())
   OR EXISTS (SELECT 1 FROM public.background_jobs WHERE organization_id=p_organization AND status='RUNNING') THEN
   RAISE EXCEPTION 'RETENTION_MEDIA_WRITES_PENDING' USING ERRCODE='42501';
 END IF;
 IF EXISTS (SELECT 1 FROM public.billing_checkout_attempts WHERE organization_id=p_organization AND status IN ('CREATING','OPEN')) THEN
   RAISE EXCEPTION 'RETENTION_PAYMENT_PENDING' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM public.organizations o JOIN public.organization_subscriptions s ON s.organization_id = o.id
   WHERE o.id = p_organization AND o.data_purge_started_at IS NOT NULL AND o.data_purged_at IS NULL
     AND s.data_retention_ends_at IS NOT NULL AND s.data_retention_ends_at <= clock_timestamp()
 ) THEN RAISE EXCEPTION 'RETENTION_DEADLINE_NOT_REACHED' USING ERRCODE = '42501'; END IF;
 IF EXISTS (
   SELECT 1 FROM public.organization_subscriptions s WHERE s.organization_id = p_organization AND s.ended_at IS NULL
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
