-- Freeze the published baseline. Subsequent changes belong to the catalog in the database.
WITH defaults (
    id, code, name, description, trial_days, monthly_minor, semiannual_minor, annual_minor,
    has_intelligence, allocation_limits, usage_limits
) AS (
    VALUES
    (
        '019a6cac-0000-7000-8000-000000000001'::uuid, 'ESSENTIAL', 'Essencial',
        'A operação completa para quem está começando a organizar o campo.',
        30, 5990, 32940, 59900, false,
        '{"BUSINESS_UNITS":1,"PLATFORM_USERS":5,"FIELD_TECHNICIANS":5,"AUXILIARY_TECHNICIANS":5,"ACTIVE_CUSTOMERS":150,"ACTIVE_EQUIPMENT":500}'::jsonb,
        '{"SERVICE_ORDERS_CREATED":500,"PMOC_DOCUMENTS_ISSUED":1000,"RVT_DOCUMENTS_ISSUED":1000,"OTHER_DOCUMENTS_ISSUED":2000,"AUTOMATION_RUNS":1000,"AI_COMPUTE":0}'::jsonb
    ),
    (
        '019a6cac-0000-7000-8000-000000000002'::uuid, 'PROFESSIONAL', 'Profissional',
        'Mais unidades, mais equipe e mais volume mensal.',
        0, 14990, 82740, 149900, false,
        '{"BUSINESS_UNITS":3,"PLATFORM_USERS":20,"FIELD_TECHNICIANS":20,"AUXILIARY_TECHNICIANS":20,"ACTIVE_CUSTOMERS":1000,"ACTIVE_EQUIPMENT":5000}'::jsonb,
        '{"SERVICE_ORDERS_CREATED":5000,"PMOC_DOCUMENTS_ISSUED":10000,"RVT_DOCUMENTS_ISSUED":10000,"OTHER_DOCUMENTS_ISSUED":20000,"AUTOMATION_RUNS":10000,"AI_COMPUTE":0}'::jsonb
    ),
    (
        '019a6cac-0000-7000-8000-000000000003'::uuid, 'PROFESSIONAL_INTELLIGENCE', 'Profissional + Inteligência',
        'O Profissional com a camada de inteligência do Orbit habilitada.',
        0, 24990, 137940, 249900, true,
        '{"BUSINESS_UNITS":3,"PLATFORM_USERS":20,"FIELD_TECHNICIANS":20,"AUXILIARY_TECHNICIANS":20,"ACTIVE_CUSTOMERS":1000,"ACTIVE_EQUIPMENT":5000}'::jsonb,
        '{"SERVICE_ORDERS_CREATED":5000,"PMOC_DOCUMENTS_ISSUED":10000,"RVT_DOCUMENTS_ISSUED":10000,"OTHER_DOCUMENTS_ISSUED":20000,"AUTOMATION_RUNS":10000,"AI_COMPUTE":null}'::jsonb
    ),
    (
        '019a6cac-0000-7000-8000-000000000004'::uuid, 'ENTERPRISE_UNLIMITED', 'Empresarial Ilimitado',
        'Sem tetos operacionais, com inteligência incluída.',
        0, 69990, 386340, 699900, true,
        '{"BUSINESS_UNITS":null,"PLATFORM_USERS":null,"FIELD_TECHNICIANS":null,"AUXILIARY_TECHNICIANS":null,"ACTIVE_CUSTOMERS":null,"ACTIVE_EQUIPMENT":null}'::jsonb,
        '{"SERVICE_ORDERS_CREATED":null,"PMOC_DOCUMENTS_ISSUED":null,"RVT_DOCUMENTS_ISSUED":null,"OTHER_DOCUMENTS_ISSUED":null,"AUTOMATION_RUNS":null,"AI_COMPUTE":null}'::jsonb
    )
), baseline AS (
    SELECT
        ARRAY[
            'CUSTOMERS', 'OPERATIONS', 'FIELD_OPERATIONS', 'EQUIPMENT', 'PMOC', 'RVT',
            'ARTIFACTS', 'DOCUMENT_TEMPLATES', 'CUSTOMER_SERVICE_REQUESTS',
            'AUTOMATIONS', 'ANALYTICS', 'INTEGRATIONS'
        ]::text[] AS operational_capabilities,
        ARRAY['ORBIT_INTELLIGENCE', 'AI_ASSISTANTS']::text[] AS intelligence_capabilities,
        ARRAY[
            'analytics.read', 'artifact_executions.execute', 'artifact_executions.manage',
            'artifact_executions.read', 'artifact_manifests.manage', 'artifact_manifests.read',
            'artifact_rendering.render', 'artifact_templates.manage', 'artifact_templates.read',
            'assets.manage', 'assets.qr.manage', 'assets.read', 'automations.manage', 'automations.read',
            'business_units.manage', 'business_units.read', 'catalog.manage', 'catalog.read',
            'checklists.execute', 'checklists.manage', 'checklists.read', 'crm.manage', 'crm.read',
            'customer_service_requests.manage', 'customer_service_requests.read', 'dashboard.read',
            'document_engine.manage', 'document_engine.read', 'financial.manage', 'financial.read',
            'integrations.manage', 'integrations.read', 'inventory.manage', 'inventory.read',
            'notifications.manage', 'notifications.read', 'operations.manage', 'operations.read',
            'pmoc.manage', 'pmoc.read', 'quotes.manage', 'quotes.read', 'reports.management.manage',
            'reports.management.read', 'reports.manage', 'reports.read', 'reports.render',
            'rvt.document', 'rvt.execute', 'rvt.manage', 'rvt.read', 'scheduling.manage',
            'scheduling.read', 'signatures.manage', 'signatures.read', 'workforce.manage', 'workforce.read'
        ]::varchar[] AS operational_routes,
        ARRAY[
            'ai.agents.manage', 'ai.agents.read', 'ai.executions.read',
            'ai.executions.run', 'scheduling.intelligence'
        ]::varchar[] AS intelligence_routes
)
INSERT INTO plans (
    id, key, name, description, monthly_price, annual_price, currency,
    capabilities, commercial, updated_at
)
SELECT
    seed.id, seed.code, seed.name, seed.description,
    seed.monthly_minor / 100.0, seed.annual_minor / 100.0, 'BRL',
    ARRAY(
        SELECT route FROM unnest(baseline.operational_routes ||
            CASE WHEN seed.has_intelligence THEN baseline.intelligence_routes ELSE ARRAY[]::varchar[] END
        ) AS routes(route) ORDER BY route COLLATE "C"
    ),
    jsonb_build_object(
        '_bootstrapStripePrices', true,
        'trialDays', seed.trial_days,
        'prices', jsonb_build_object(
            'MONTHLY', jsonb_build_object('amountMinor', seed.monthly_minor, 'currency', 'BRL'),
            'SEMIANNUAL', jsonb_build_object('amountMinor', seed.semiannual_minor, 'currency', 'BRL'),
            'ANNUAL', jsonb_build_object('amountMinor', seed.annual_minor, 'currency', 'BRL')
        ),
        'entitlements', jsonb_build_object(
            'label', seed.name,
            'capabilities', baseline.operational_capabilities ||
                CASE WHEN seed.has_intelligence THEN baseline.intelligence_capabilities ELSE ARRAY[]::text[] END,
            'allocation', seed.allocation_limits,
            'usage', seed.usage_limits
        )
    ),
    CURRENT_TIMESTAMP
FROM defaults AS seed CROSS JOIN baseline
ON CONFLICT (key) DO UPDATE SET
    description = COALESCE(plans.description, EXCLUDED.description),
    monthly_price = EXCLUDED.monthly_price,
    annual_price = EXCLUDED.annual_price,
    currency = EXCLUDED.currency,
    capabilities = EXCLUDED.capabilities,
    commercial = EXCLUDED.commercial,
    updated_at = EXCLUDED.updated_at
WHERE plans.commercial IS NULL
  AND plans.catalog_tenant_id IS NULL
  AND plans.catalog_version = 1;
