-- The open queue is intentionally independent from creation/delivery cohorts.
-- Keep its index proportional to open jobs, including old ones.
CREATE INDEX "operations_analytics_open_idx"
  ON "operations" ("organization_id", "business_unit_id", "created_at")
  INCLUDE ("scheduled_start", "scheduled_end", "responsible_field_technician_id")
  WHERE "deleted_at" IS NULL
    AND "status" NOT IN ('CANCELLED', 'CANCELED')
    AND "status" NOT IN ('COMPLETED', 'DONE', 'CLOSED', 'FINALIZED', 'PUBLISHED');

-- Match scheduling-time.ts: calculate a provisional offset, then recalculate
-- at that instant. This preserves the established choice for folds and gaps.
-- No elevated privileges, external state, or table access.
CREATE FUNCTION public.orbit_analytics_civil_instant(local_time timestamp, zone text)
RETURNS timestamptz
LANGUAGE sql STABLE STRICT PARALLEL SAFE
AS $$
  SELECT guess - ((first AT TIME ZONE zone) - (first AT TIME ZONE 'UTC'))
    FROM (SELECT local_time AT TIME ZONE 'UTC' AS guess) g
    CROSS JOIN LATERAL (SELECT guess - ((guess AT TIME ZONE zone) - local_time) AS first) p
$$;
