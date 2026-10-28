ALTER TABLE rvt_occurrences
  ADD COLUMN authorized_at TIMESTAMPTZ(3),
  ADD COLUMN authorized_by_id UUID;
ALTER TABLE pmoc_executions
  ADD COLUMN authorized_at TIMESTAMPTZ(3),
  ADD COLUMN authorized_by_id UUID;

-- Preserve explicit approvals already recorded on the linked operation.
UPDATE rvt_occurrences occurrence SET authorized_at = operation.authorized_at,
  authorized_by_id = operation.authorized_by_id
FROM rvt_executions execution JOIN operations operation ON operation.id = execution.operation_id
WHERE execution.occurrence_id = occurrence.id AND operation.organization_id = occurrence.organization_id;
UPDATE pmoc_executions cycle SET authorized_at = operation.authorized_at,
  authorized_by_id = operation.authorized_by_id
FROM operations operation WHERE operation.id = cycle.operation_id AND operation.organization_id = cycle.organization_id;

CREATE INDEX rvt_occurrences_authorization_idx ON rvt_occurrences (organization_id, authorized_at, status);
CREATE INDEX pmoc_executions_authorization_idx ON pmoc_executions (organization_id, authorized_at, status);
