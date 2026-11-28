ALTER TABLE sessions
  ADD COLUMN previous_refresh_token_hash VARCHAR(255),
  ADD COLUMN rotation_response TEXT,
  ADD COLUMN rotation_grace_until TIMESTAMPTZ(3),
  ADD CONSTRAINT sessions_rotation_state_valid CHECK (
    (previous_refresh_token_hash IS NULL AND rotation_response IS NULL AND rotation_grace_until IS NULL)
    OR (previous_refresh_token_hash IS NOT NULL AND rotation_response IS NOT NULL AND rotation_grace_until IS NOT NULL)
  );
CREATE UNIQUE INDEX sessions_previous_refresh_token_hash_key ON sessions(previous_refresh_token_hash);

-- A revoked session must never keep an eligible replay response, regardless of
-- which flow revoked it (logout, reset, role/surface change or tenant blocking).
CREATE FUNCTION app_clear_revoked_session_rotation() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    NEW.previous_refresh_token_hash := NULL;
    NEW.rotation_response := NULL;
    NEW.rotation_grace_until := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_clear_revoked_rotation
  BEFORE INSERT OR UPDATE ON sessions FOR EACH ROW
  EXECUTE FUNCTION app_clear_revoked_session_rotation();
