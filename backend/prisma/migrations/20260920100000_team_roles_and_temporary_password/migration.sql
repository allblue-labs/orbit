-- Papéis de técnico para as organizações que já existem.
--
-- O registro passa a criá-los junto com OWNER, mas quem abriu a conta antes
-- desta migração continuaria sem papel algum para atribuir a um técnico — e a
-- tela de equipe abriria com um seletor de uma opção só.
--
-- O id é UUIDv7 construído em SQL, como nas outras migrações de backfill:
-- a coluna guarda v7 em todo o resto do sistema, e um v4 aqui quebraria a
-- ordenação por id que a paginação por cursor usa.
--
-- `ON CONFLICT DO NOTHING` contra a unicidade (organization_id, key): a
-- migração é idempotente e não sobrescreve um papel que a organização tenha
-- criado à mão com a mesma chave.

INSERT INTO roles (id, organization_id, key, name, description, permissions, is_system, created_at, updated_at)
SELECT
  (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  o.id,
  'FIELD_TECHNICIAN',
  'Técnico operacional',
  'Executa o atendimento em campo: abre, preenche o checklist, registra material, emite e fecha.',
  ARRAY[
    'operations.read','operations.attachments.read','operations.history.read',
    'customers.read','contacts.read','assets.read','checklists.read',
    'scheduling.read','inventory.read','catalog.read','pmoc.read','rvt.read',
    'reports.read','reports.documents.read','artifact_executions.read',
    'artifact_manifests.read','notifications.read',
    'operations.update','operations.status.update','operations.attachments.create',
    'checklists.execute','checklists.update','inventory.manage',
    'rvt.execute','rvt.document','artifact_executions.create',
    'artifact_executions.execute','artifact_executions.update',
    'artifact_manifests.issue','artifact_rendering.render',
    'signatures.create','signatures.read','reports.create','reports.update',
    'reports.status.update','reports.finalize','reports.render'
  ]::varchar(160)[],
  false,
  now(),
  now()
FROM organizations o
WHERE o.deleted_at IS NULL
ON CONFLICT (organization_id, key) DO NOTHING;

INSERT INTO roles (id, organization_id, key, name, description, permissions, is_system, created_at, updated_at)
SELECT
  (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  o.id,
  'ASSISTANT_TECHNICIAN',
  'Técnico auxiliar',
  'Acompanha o atendimento: vê o que foi atribuído, abre a rota e compartilha o documento já emitido. Não executa nem emite.',
  ARRAY[
    'operations.read','operations.attachments.read','operations.history.read',
    'customers.read','contacts.read','assets.read','checklists.read',
    'scheduling.read','inventory.read','catalog.read','pmoc.read','rvt.read',
    'reports.read','reports.documents.read','artifact_executions.read',
    'artifact_manifests.read','notifications.read'
  ]::varchar(160)[],
  false,
  now(),
  now()
FROM organizations o
WHERE o.deleted_at IS NULL
ON CONFLICT (organization_id, key) DO NOTHING;
