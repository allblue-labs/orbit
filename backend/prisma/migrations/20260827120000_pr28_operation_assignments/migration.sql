-- PR-28 — Técnico em Campo responsável + 0..N auxiliares técnico.
ALTER TABLE operations
  ADD COLUMN responsible_field_technician_id UUID,
  ADD COLUMN started_by_user_id UUID,
  ADD COLUMN completed_by_user_id UUID;

CREATE TABLE operation_auxiliary_technicians (
  id UUID NOT NULL,
  organization_id UUID NOT NULL,
  operation_id UUID NOT NULL,
  user_id UUID NOT NULL,
  assigned_by_id UUID NOT NULL,
  assigned_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_by_id UUID,
  removed_at TIMESTAMPTZ(3),
  CONSTRAINT operation_auxiliary_technicians_pkey PRIMARY KEY (id)
);

ALTER TABLE operations ADD CONSTRAINT operations_responsible_field_technician_id_fkey FOREIGN KEY (responsible_field_technician_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE operations ADD CONSTRAINT operations_started_by_user_id_fkey FOREIGN KEY (started_by_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE operations ADD CONSTRAINT operations_completed_by_user_id_fkey FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE operation_auxiliary_technicians ADD CONSTRAINT operation_auxiliary_technicians_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE operation_auxiliary_technicians ADD CONSTRAINT operation_auxiliary_technicians_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES operations(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE operation_auxiliary_technicians ADD CONSTRAINT operation_auxiliary_technicians_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE operation_auxiliary_technicians ADD CONSTRAINT operation_auxiliary_technicians_assigned_by_id_fkey FOREIGN KEY (assigned_by_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE operation_auxiliary_technicians ADD CONSTRAINT operation_auxiliary_technicians_removed_by_id_fkey FOREIGN KEY (removed_by_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX operations_responsible_field_work_queue_idx ON operations(organization_id, responsible_field_technician_id, status, scheduled_start);
CREATE INDEX operation_auxiliary_work_queue_idx ON operation_auxiliary_technicians(organization_id, user_id, removed_at);
CREATE INDEX operation_auxiliary_operation_idx ON operation_auxiliary_technicians(operation_id, removed_at, assigned_at);
CREATE UNIQUE INDEX operation_auxiliary_one_active_user ON operation_auxiliary_technicians(operation_id, user_id) WHERE removed_at IS NULL;

-- Um único vínculo legado é evidência inequívoca. Múltiplos vínculos não são
-- reinterpretados e nenhum auxiliar é inventado.
UPDATE operations o SET responsible_field_technician_id = legacy.user_id
FROM (
  SELECT operation_id, min(user_id::text)::uuid AS user_id
  FROM operation_users GROUP BY operation_id HAVING count(*) = 1
) legacy WHERE legacy.operation_id = o.id;

-- O ator real da primeira entrada em execução/conclusão é congelado; o
-- responsável atual nunca substitui retroativamente o executor histórico.
UPDATE operations o SET started_by_user_id = (
  SELECT h.user_id FROM operation_history h
  WHERE h.operation_id=o.id AND h.to_status='IN_PROGRESS' AND h.user_id IS NOT NULL
  ORDER BY h.created_at ASC LIMIT 1
) WHERE o.started_at IS NOT NULL;

UPDATE operations o SET completed_by_user_id = (
  SELECT h.user_id FROM operation_history h
  WHERE h.operation_id=o.id AND h.to_status='COMPLETED' AND h.user_id IS NOT NULL
  ORDER BY h.created_at ASC LIMIT 1
) WHERE o.completed_at IS NOT NULL;

-- Projeção inicial para eventos de Operation. Writes futuros são unidirecionais
-- Operation -> Scheduling; a agenda não se torna segunda autoridade.
INSERT INTO scheduling_resource_allocations (id,event_id,user_id,resource_type,role,status)
SELECT gen_random_uuid(), e.id, o.responsible_field_technician_id, 'USER', 'RESPONSIBLE_FIELD_TECHNICIAN', 'ALLOCATED'
FROM scheduling_events e JOIN operations o ON o.id=e.source_entity_id
WHERE e.source_module='operations' AND e.source_entity_type='OPERATION'
  AND e.deleted_at IS NULL AND o.responsible_field_technician_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM scheduling_resource_allocations a WHERE a.event_id=e.id AND a.user_id=o.responsible_field_technician_id AND a.deleted_at IS NULL);

ALTER TABLE operation_auxiliary_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_auxiliary_technicians FORCE ROW LEVEL SECURITY;
CREATE POLICY operation_auxiliary_technicians_parent_isolation ON operation_auxiliary_technicians FOR ALL
USING (app_is_platform_admin() OR (
  organization_id=app_current_organization_id() AND EXISTS (
    SELECT 1 FROM operations o WHERE o.id=operation_auxiliary_technicians.operation_id AND o.organization_id=operation_auxiliary_technicians.organization_id
  )
))
WITH CHECK (app_is_platform_admin() OR (
  organization_id=app_current_organization_id() AND EXISTS (
    SELECT 1 FROM operations o WHERE o.id=operation_auxiliary_technicians.operation_id AND o.organization_id=operation_auxiliary_technicians.organization_id
  )
));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE operation_auxiliary_technicians TO orbit_app;
