-- Corrige somente ordens comprovadamente abertas pelo próprio atendente via
-- comando mobile. Reatribuições e demandas distribuídas pelo escritório
-- continuam sujeitas à autorização da organização.
UPDATE operations o
   SET authorized_at = COALESCE(o.started_at, o.created_at),
       authorized_by_id = o.created_by_id,
       updated_at = CURRENT_TIMESTAMP
 WHERE o.authorized_at IS NULL
   AND o.deleted_at IS NULL
   AND o.data->>'source' = 'MOBILE_WALK_IN'
   AND o.responsible_field_technician_id = o.created_by_id
   AND NOT EXISTS (
     SELECT 1 FROM operation_history h
      WHERE h.operation_id = o.id
        AND h.action IN ('ASSIGNMENT_AUTHORIZATION_REVOKED', 'RESPONSIBLE_FIELD_TECHNICIAN_REPLACED')
   )
   AND EXISTS (
     SELECT 1 FROM operation_walk_in_commands c
      WHERE c.operation_id = o.id AND c.organization_id = o.organization_id
        AND c.business_unit_id = o.business_unit_id AND c.actor_id = o.created_by_id
   );
