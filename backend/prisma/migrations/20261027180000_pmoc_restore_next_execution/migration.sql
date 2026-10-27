-- Recupera planos cujo atendimento antecipado calculou um vencimento já
-- concluído. O índice (plan_id, due_on) impediu a criação do próximo ciclo.
-- Preserva o histórico e só reabre a programação de planos ativos, ainda
-- dentro da vigência e sem nenhuma execução pendente.
WITH completed AS (
  SELECT plan_id, organization_id, max(due_on) AS last_due_on
  FROM pmoc_executions
  WHERE status = 'COMPLETED'
  GROUP BY plan_id, organization_id
), stalled AS (
  SELECT p.id, p.organization_id,
    (GREATEST(p.last_executed_at::date, c.last_due_on) + make_interval(
      years => CASE WHEN p.frequency_unit = 'YEARS' THEN p.frequency_amount ELSE 0 END,
      months => CASE WHEN p.frequency_unit = 'MONTHS' THEN p.frequency_amount ELSE 0 END,
      weeks => CASE WHEN p.frequency_unit = 'WEEKS' THEN p.frequency_amount ELSE 0 END,
      days => CASE WHEN p.frequency_unit = 'DAYS' THEN p.frequency_amount ELSE 0 END
    ))::date AS due_on
  FROM pmoc_plans p
  JOIN completed c ON c.plan_id = p.id AND c.organization_id = p.organization_id
  WHERE p.status = 'ACTIVE' AND p.deleted_at IS NULL
    AND p.last_executed_at IS NOT NULL
    AND p.next_due_on <= c.last_due_on
    AND NOT EXISTS (
      SELECT 1 FROM pmoc_executions e
      WHERE e.plan_id = p.id AND e.organization_id = p.organization_id
        AND e.status = 'PENDING'
    )
), repaired AS (
  UPDATE pmoc_plans p
  SET next_due_on = s.due_on, due_soon_notified_for = NULL,
      overdue_notified_for = NULL, updated_at = now()
  FROM stalled s
  WHERE p.id = s.id AND p.organization_id = s.organization_id
    AND (p.ends_on IS NULL OR p.ends_on >= s.due_on)
  RETURNING p.id, p.organization_id, p.next_due_on
)
INSERT INTO pmoc_executions (
  id, organization_id, plan_id, due_on, status, sequence_number, updated_at
)
SELECT (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  r.organization_id, r.id, r.next_due_on, 'PENDING',
  (SELECT coalesce(max(e.sequence_number), 0) + 1 FROM pmoc_executions e
   WHERE e.plan_id = r.id AND e.organization_id = r.organization_id), now()
FROM repaired r
ON CONFLICT DO NOTHING;
