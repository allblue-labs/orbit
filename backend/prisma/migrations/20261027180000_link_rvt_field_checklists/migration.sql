-- Torna os roteiros de visitas existentes acessíveis pelo mesmo contrato de campo.
UPDATE checklist_executions AS checklist
SET operation_id = execution.operation_id
FROM rvt_executions AS execution
WHERE checklist.rvt_execution_id = execution.id
  AND checklist.organization_id = execution.organization_id
  AND checklist.operation_id IS NULL
  AND execution.operation_id IS NOT NULL;
