-- ORBIT V2 — Expurgo por retenção aceita `product_sales`.
--
-- A tabela de vendas entrou na lista de expurgo do código
-- (`OPERATIONAL_PURGE_TABLES`), mas não na lista que a função aceita. Como a
-- função recusa o nome da tabela antes de olhar os dados, todo expurgo parava
-- em `RETENTION_TABLE_NOT_ALLOWED` — inclusive o de quem nunca vendeu nada.
-- Mesma função, mesma regra, com a tabela que faltava.

CREATE OR REPLACE FUNCTION app_purge_expired_tenant_table(p_organization uuid, p_table text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE removed bigint;
BEGIN
 IF current_setting('app.is_platform_admin',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'RETENTION_PLATFORM_CONTEXT_REQUIRED' USING ERRCODE = '42501';
 END IF;
 IF NOT (p_table = ANY(ARRAY['identity_invitations','plan_usage','plan_usage_events','integrations','customers','customer_addresses','contacts','customer_portal_identities','customer_portal_sessions','customer_portal_invitations','customer_portal_password_resets','product_categories','product_sku_sequences','products','asset_internal_code_sequences','assets','equipment_qr_identities','operations','customer_service_requests','customer_service_request_events','service_order_sequences','operation_auxiliary_technicians','checklist_templates','artifact_templates','artifact_template_versions','receipt_sequences','artifact_snapshots','artifact_executions','field_artifacts','artifact_execution_responses','artifact_execution_attachments','artifact_execution_signatures','artifact_execution_insights','storage_upload_admissions','storage_files','field_evidence_uploads','field_evidence','operation_cancellation_requests','artifact_manifests','checklist_executions','report_templates','reports','generated_documents','signatures','notifications','mobile_device_installations','mobile_push_deliveries','notification_preferences','push_subscriptions','ai_agents','ai_executions','scheduling_calendars','scheduling_events','scheduling_availability','audit_logs','background_jobs','specialties','member_specialties','member_certifications','teams','team_memberships','member_locations','professional_profiles','professional_credentials','user_signatures','customer_acknowledgements','mobile_offline_command_receipts','mobile_sync_changes','financial_categories','financial_entries','financial_settings','commission_policies','commission_cancellations','commission_payments','commission_payment_items','quotes','quote_acceptance_links','quote_items','inventory_movements','inventory_balances','domain_events','automation_rules','automation_executions','management_reports','pmoc_plans','pmoc_code_sequences','pmoc_equipment_coverages','pmoc_equipment_schedules','pmoc_units','pmoc_plan_signature_links','pmoc_executions','pmoc_equipment_executions','pmoc_equipment_evidence','rvt_maintenance_types','rvt_configurations','rvt_configuration_equipment','rvt_occurrences','rvt_executions','rvt_execution_equipment','rvt_execution_evidence','operation_walk_in_commands','rvt_ad_hoc_commands','operation_materials','product_sales']::text[])) THEN
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
