/** Apenas conteúdo operacional; conta, antifraude, aceite e cobrança ficam separados. */
export const OPERATIONAL_PURGE_TABLES = [
  'identity_invitations',
  'plan_usage',
  'plan_usage_events',
  'integrations',
  'customers',
  'customer_addresses',
  'contacts',
  'customer_portal_identities',
  'customer_portal_sessions',
  'customer_portal_invitations',
  'customer_portal_password_resets',
  'product_categories',
  'product_sku_sequences',
  'products',
  'asset_internal_code_sequences',
  'assets',
  'equipment_qr_identities',
  'operations',
  'customer_service_requests',
  'customer_service_request_events',
  'service_order_sequences',
  'operation_auxiliary_technicians',
  'checklist_templates',
  'artifact_templates',
  'artifact_template_versions',
  'receipt_sequences',
  'artifact_snapshots',
  'artifact_executions',
  'field_artifacts',
  'artifact_execution_responses',
  'artifact_execution_attachments',
  'artifact_execution_signatures',
  'artifact_execution_insights',
  'storage_files',
  'field_evidence_uploads',
  'field_evidence',
  'operation_cancellation_requests',
  'artifact_manifests',
  'checklist_executions',
  'report_templates',
  'reports',
  'generated_documents',
  'signatures',
  'notifications',
  'mobile_device_installations',
  'mobile_push_deliveries',
  'notification_preferences',
  'push_subscriptions',
  'ai_agents',
  'ai_executions',
  'scheduling_calendars',
  'scheduling_events',
  'scheduling_availability',
  'audit_logs',
  'background_jobs',
  'specialties',
  'member_specialties',
  'member_certifications',
  'teams',
  'team_memberships',
  'member_locations',
  'professional_profiles',
  'professional_credentials',
  'user_signatures',
  'customer_acknowledgements',
  'mobile_offline_command_receipts',
  'mobile_sync_changes',
  'financial_categories',
  'financial_entries',
  'financial_settings',
  'commission_policies',
  'commission_cancellations',
  'commission_payments',
  'commission_payment_items',
  'quotes',
  'quote_items',
  'inventory_movements',
  'inventory_balances',
  'domain_events',
  'automation_rules',
  'automation_executions',
  'management_reports',
  'pmoc_plans',
  'pmoc_code_sequences',
  'pmoc_equipment_coverages',
  'pmoc_units',
  'pmoc_plan_signature_links',
  'pmoc_executions',
  'pmoc_equipment_executions',
  'pmoc_equipment_evidence',
  'rvt_maintenance_types',
  'rvt_configurations',
  'rvt_configuration_equipment',
  'rvt_occurrences',
  'rvt_executions',
  'rvt_execution_equipment',
  'rvt_execution_evidence',
  'operation_walk_in_commands',
  'rvt_ad_hoc_commands',
  'operation_materials',
] as const;

/** Filhos antes dos pais, incluindo FKs RESTRICT; ciclos falham antes de apagar. */
export function purgeOrder(
  tables: readonly string[],
  edges: readonly { child: string; parent: string }[],
): string[] {
  const remaining = new Set(tables);
  const ordered: string[] = [];
  while (remaining.size) {
    const leaves = [...remaining].filter(
      (table) =>
        !edges.some(
          (edge) =>
            edge.parent === table &&
            edge.child !== table &&
            remaining.has(edge.child),
        ),
    );
    if (!leaves.length) throw new Error('RETENTION_FOREIGN_KEY_CYCLE');
    for (const table of leaves) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}
