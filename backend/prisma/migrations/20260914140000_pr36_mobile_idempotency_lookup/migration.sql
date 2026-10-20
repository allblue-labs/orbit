-- Mobile commands use an actor-scoped idempotency key stored in JSON details.
-- Without this expression index, finding an old receipt requires scanning the
-- actor's operation history or imposing an unsafe recency cap.
CREATE INDEX operation_history_idempotency_lookup_idx
ON operation_history (
  user_id,
  action,
  ((details ->> 'idempotencyKey')),
  created_at DESC
)
INCLUDE (operation_id)
WHERE user_id IS NOT NULL
  AND details ? 'idempotencyKey';
