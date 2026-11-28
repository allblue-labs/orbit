CREATE TABLE auth_rate_limit_buckets (
  scope_hash CHAR(64) PRIMARY KEY CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  shard SMALLINT NOT NULL CHECK (shard BETWEEN 0 AND 15),
  attempts INTEGER NOT NULL CHECK (attempts >= 1),
  expires_at TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX auth_rate_limit_buckets_shard_expires_at_idx ON auth_rate_limit_buckets(shard, expires_at);
ALTER TABLE auth_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_rate_limit_buckets FORCE ROW LEVEL SECURITY;

-- Runtime has no table policy; only this bounded security-definer operation.
-- At most 16 * 1024 keys. Bounded lazy cleanup never evicts active counters
-- or prolongs a fixed window. Existing keys lock only their row.
CREATE FUNCTION app_auth_rate_limit_consume(p_hash TEXT, p_max INTEGER, p_window_ms INTEGER)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row auth_rate_limit_buckets%ROWTYPE;
  v_shard SMALLINT;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR p_max IS NULL OR p_max NOT BETWEEN 1 AND 100000
    OR p_window_ms IS NULL OR p_window_ms NOT BETWEEN 1 AND 3600000 THEN
    RAISE EXCEPTION 'Invalid authentication rate-limit input';
  END IF;
  v_shard := get_byte(decode(p_hash, 'hex'), 0) % 16;
  SELECT * INTO v_row FROM auth_rate_limit_buckets WHERE scope_hash = p_hash FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM pg_advisory_xact_lock(131305, v_shard::int);
    SELECT * INTO v_row FROM auth_rate_limit_buckets WHERE scope_hash = p_hash FOR UPDATE;
    IF NOT FOUND THEN
      v_now := clock_timestamp();
      DELETE FROM auth_rate_limit_buckets WHERE scope_hash IN (
        SELECT scope_hash FROM auth_rate_limit_buckets WHERE shard = v_shard AND expires_at <= v_now
        ORDER BY expires_at LIMIT 64 FOR UPDATE SKIP LOCKED
      );
      IF (SELECT count(*) FROM auth_rate_limit_buckets WHERE shard = v_shard) >= 1024 THEN
        RETURN QUERY SELECT false, 60; RETURN;
      END IF;
      INSERT INTO auth_rate_limit_buckets(scope_hash, shard, attempts, expires_at)
        VALUES(p_hash, v_shard, 1, v_now + p_window_ms * interval '1 millisecond');
      RETURN QUERY SELECT true, 0; RETURN;
    END IF;
  END IF;
  v_now := clock_timestamp();
  IF v_row.expires_at <= v_now THEN
    UPDATE auth_rate_limit_buckets SET attempts = 1, expires_at = v_now + p_window_ms * interval '1 millisecond'
      WHERE scope_hash = p_hash;
    RETURN QUERY SELECT true, 0; RETURN;
  END IF;
  IF v_row.attempts >= p_max THEN
    RETURN QUERY SELECT false, GREATEST(1, ceil(extract(epoch FROM v_row.expires_at - v_now))::int); RETURN;
  END IF;
  UPDATE auth_rate_limit_buckets SET attempts = attempts + 1 WHERE scope_hash = p_hash;
  RETURN QUERY SELECT true, 0;
END;
$$;
REVOKE ALL ON FUNCTION app_auth_rate_limit_consume(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_auth_rate_limit_consume(TEXT, INTEGER, INTEGER) TO orbit_app;
