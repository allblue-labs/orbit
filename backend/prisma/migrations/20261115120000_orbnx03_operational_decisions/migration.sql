-- Durable idempotency receipts reuse the existing audited decision, not a second tenant state.
CREATE UNIQUE INDEX tenant_operational_decision_idempotency
ON audit_logs (organization_id, (metadata->>'idempotencyKeyHash'))
WHERE action = 'TENANT_OPERATIONAL_STATUS_CHANGED';
