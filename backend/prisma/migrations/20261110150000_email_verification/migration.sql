CREATE TABLE email_verification_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  email VARCHAR(320) NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ(3) NOT NULL,
  used_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX email_verification_tokens_expires_at_idx ON email_verification_tokens(expires_at);
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY email_verification_owner ON email_verification_tokens FOR ALL
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON email_verification_tokens TO orbit_app;

-- The public route has no session. Possession of the unguessable token is its
-- authority; this narrow function exposes no identity data and consumes once.
CREATE FUNCTION app_confirm_email(p_token_hash TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_token email_verification_tokens%ROWTYPE;
  v_email TEXT;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_token FROM email_verification_tokens WHERE token_hash = p_token_hash;
  IF NOT FOUND OR v_token.used_at IS NOT NULL OR v_token.expires_at <= clock_timestamp() THEN RETURN FALSE; END IF;
  SELECT normalized_email INTO v_email FROM users
    WHERE id = v_token.user_id AND status = 'ACTIVE' AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_email <> v_token.email THEN RETURN FALSE; END IF;
  UPDATE email_verification_tokens SET used_at = clock_timestamp()
    WHERE id = v_token.id AND token_hash = p_token_hash AND used_at IS NULL AND expires_at > clock_timestamp();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RETURN FALSE; END IF;
  UPDATE users SET email_verified_at = COALESCE(email_verified_at, clock_timestamp()), updated_at = clock_timestamp()
    WHERE id = v_token.user_id;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION app_confirm_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_confirm_email(TEXT) TO orbit_app;

-- Mailbox proof never transfers to an address edited through another flow.
CREATE FUNCTION app_invalidate_changed_email_verification() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.normalized_email IS DISTINCT FROM OLD.normalized_email THEN
    NEW.email_verified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_invalidate_email_verification
  BEFORE UPDATE OF normalized_email ON users FOR EACH ROW
  EXECUTE FUNCTION app_invalidate_changed_email_verification();
