-- ORB-NX-02: diagnostic ONLY; use an authorized read connection.
-- Compares stored states; effective time-based state is projected by the API.
-- Does not infer revenue, repair data or call Stripe.
BEGIN READ ONLY;
WITH canonical AS (
  SELECT DISTINCT ON (organization_id) organization_id, id, plan_code, status,
    current_period_end, pending_plan_code, pending_effective_at, cancel_at_period_end
  FROM organization_subscriptions
  ORDER BY organization_id, (ended_at IS NULL) DESC, started_at DESC, id DESC
)
SELECT o.id AS organization_id, s.id AS canonical_subscription_id,
  p.key AS legacy_plan_key, o.subscription_status AS legacy_status,
  o.current_period_end AS legacy_period_end,
  s.plan_code AS canonical_plan_code, s.status AS stored_canonical_status,
  s.current_period_end AS canonical_period_end,
  s.pending_plan_code, s.pending_effective_at, s.cancel_at_period_end,
  CASE WHEN s.id IS NULL THEN 'UNKNOWN_LEGACY' ELSE 'STORED_STATE_DIVERGENCE' END AS diagnosis
FROM organizations o JOIN plans p ON p.id=o.plan_id
LEFT JOIN canonical s ON s.organization_id=o.id
WHERE o.deleted_at IS NULL AND (
  s.id IS NULL OR p.key IS DISTINCT FROM s.plan_code
  OR o.subscription_status IS DISTINCT FROM s.status
  OR o.current_period_end IS DISTINCT FROM s.current_period_end
)
ORDER BY o.id;
COMMIT;
