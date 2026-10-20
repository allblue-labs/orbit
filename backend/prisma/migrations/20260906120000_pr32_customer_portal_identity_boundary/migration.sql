-- ORBIT V2 PR-32 — Customer Portal Identity & Security Boundary.
-- External identities, credentials and sessions are deliberately independent
-- from users/credentials/sessions used by internal operators.

CREATE OR REPLACE FUNCTION app_current_actor_type()
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.actor_type', true), ''), 'ANONYMOUS')
$$;

CREATE OR REPLACE FUNCTION app_current_portal_identity_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.portal_identity_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_customer_id()
RETURNS uuid LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.customer_id', true), '')::uuid
$$;

CREATE TABLE "customer_portal_identities" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "contact_id" UUID,
  "email" VARCHAR(320) NOT NULL,
  "normalized_email" VARCHAR(320) NOT NULL,
  "display_name" VARCHAR(180) NOT NULL,
  "password_hash" VARCHAR(255),
  "status" VARCHAR(30) NOT NULL DEFAULT 'INVITED',
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(3),
  "email_verified_at" TIMESTAMPTZ(3),
  "password_updated_at" TIMESTAMPTZ(3),
  "last_login_at" TIMESTAMPTZ(3),
  "disabled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_portal_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_portal_identities_status_check"
    CHECK ("status" IN ('INVITED', 'ACTIVE', 'DISABLED')),
  CONSTRAINT "customer_portal_identities_failed_attempts_check"
    CHECK ("failed_attempts" >= 0),
  CONSTRAINT "customer_portal_identities_active_credential_check"
    CHECK ("status" <> 'ACTIVE' OR ("password_hash" IS NOT NULL AND "email_verified_at" IS NOT NULL)),
  CONSTRAINT "customer_portal_identities_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_portal_identities_customer_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_portal_identities_contact_fk"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "customer_portal_identities_org_email_key"
  ON "customer_portal_identities"("organization_id", "normalized_email");
CREATE UNIQUE INDEX "customer_portal_identities_scope_key"
  ON "customer_portal_identities"("id", "organization_id", "customer_id");
CREATE INDEX "customer_portal_identities_customer_status_idx"
  ON "customer_portal_identities"("organization_id", "customer_id", "status");
CREATE INDEX "customer_portal_identities_contact_idx"
  ON "customer_portal_identities"("contact_id");

CREATE TABLE "customer_portal_sessions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "portal_identity_id" UUID NOT NULL,
  "refresh_token_hash" CHAR(64) NOT NULL,
  "user_agent" TEXT,
  "ip_address" INET,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_portal_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_portal_sessions_refresh_hash_check"
    CHECK ("refresh_token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "customer_portal_sessions_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_portal_sessions_customer_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_portal_sessions_identity_fk"
    FOREIGN KEY ("portal_identity_id") REFERENCES "customer_portal_identities"("id") ON DELETE CASCADE,
  CONSTRAINT "customer_portal_sessions_scope_fk"
    FOREIGN KEY ("portal_identity_id", "organization_id", "customer_id")
    REFERENCES "customer_portal_identities"("id", "organization_id", "customer_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "customer_portal_sessions_refresh_key"
  ON "customer_portal_sessions"("refresh_token_hash");
CREATE INDEX "customer_portal_sessions_identity_expiry_idx"
  ON "customer_portal_sessions"("portal_identity_id", "expires_at", "revoked_at");
CREATE INDEX "customer_portal_sessions_scope_idx"
  ON "customer_portal_sessions"("organization_id", "customer_id");

CREATE TABLE "customer_portal_invitations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "portal_identity_id" UUID NOT NULL,
  "invited_by_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_portal_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_portal_invitations_token_hash_check"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "customer_portal_invitations_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_portal_invitations_customer_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_portal_invitations_identity_fk"
    FOREIGN KEY ("portal_identity_id") REFERENCES "customer_portal_identities"("id") ON DELETE CASCADE,
  CONSTRAINT "customer_portal_invitations_scope_fk"
    FOREIGN KEY ("portal_identity_id", "organization_id", "customer_id")
    REFERENCES "customer_portal_identities"("id", "organization_id", "customer_id") ON DELETE CASCADE,
  CONSTRAINT "customer_portal_invitations_inviter_fk"
    FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "customer_portal_invitations_token_key"
  ON "customer_portal_invitations"("token_hash");
CREATE UNIQUE INDEX "customer_portal_invitations_one_pending"
  ON "customer_portal_invitations"("portal_identity_id")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
CREATE INDEX "customer_portal_invitations_scope_created_idx"
  ON "customer_portal_invitations"("organization_id", "customer_id", "created_at");

CREATE TABLE "customer_portal_password_resets" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "portal_identity_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_portal_password_resets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_portal_password_resets_token_hash_check"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "customer_portal_password_resets_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_portal_password_resets_customer_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
  CONSTRAINT "customer_portal_password_resets_identity_fk"
    FOREIGN KEY ("portal_identity_id") REFERENCES "customer_portal_identities"("id") ON DELETE CASCADE,
  CONSTRAINT "customer_portal_password_resets_scope_fk"
    FOREIGN KEY ("portal_identity_id", "organization_id", "customer_id")
    REFERENCES "customer_portal_identities"("id", "organization_id", "customer_id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "customer_portal_password_resets_token_key"
  ON "customer_portal_password_resets"("token_hash");
CREATE UNIQUE INDEX "customer_portal_password_resets_one_pending"
  ON "customer_portal_password_resets"("portal_identity_id")
  WHERE "used_at" IS NULL;
CREATE INDEX "customer_portal_password_resets_scope_idx"
  ON "customer_portal_password_resets"("organization_id", "customer_id");

CREATE TABLE "customer_portal_rate_limits" (
  "id" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "scope_hash" CHAR(64) NOT NULL,
  "window_start" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "blocked_until" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_portal_rate_limits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_portal_rate_limits_scope_hash_check"
    CHECK ("scope_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "customer_portal_rate_limits_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "customer_portal_rate_limits_action_scope_key"
  ON "customer_portal_rate_limits"("action", "scope_hash");
CREATE INDEX "customer_portal_rate_limits_blocked_idx"
  ON "customer_portal_rate_limits"("blocked_until");

CREATE OR REPLACE FUNCTION app_assert_customer_portal_identity_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customers c
     WHERE c.id = NEW.customer_id
       AND c.organization_id = NEW.organization_id
       AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'customer portal identity scope mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM contacts c
     WHERE c.id = NEW.contact_id
       AND c.organization_id = NEW.organization_id
       AND c.customer_id = NEW.customer_id
       AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'customer portal contact scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "customer_portal_identity_scope_guard"
  BEFORE INSERT OR UPDATE OF "organization_id", "customer_id", "contact_id"
  ON "customer_portal_identities"
  FOR EACH ROW EXECUTE FUNCTION app_assert_customer_portal_identity_scope();

ALTER TABLE "customer_portal_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_identities" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_invitations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_password_resets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_password_resets" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_rate_limits" FORCE ROW LEVEL SECURITY;

CREATE POLICY "customer_portal_identities_self_read" ON "customer_portal_identities"
  FOR SELECT USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "id" = app_current_portal_identity_id()
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
  );
CREATE POLICY "customer_portal_identities_internal_manage" ON "customer_portal_identities"
  FOR ALL USING (
    app_current_actor_type() = 'INTERNAL_USER'
    AND "organization_id" = app_current_organization_id()
    AND (app_has_permission('customers.update') OR app_has_permission('*'))
  ) WITH CHECK (
    app_current_actor_type() = 'INTERNAL_USER'
    AND "organization_id" = app_current_organization_id()
    AND (app_has_permission('customers.update') OR app_has_permission('*'))
  );

CREATE POLICY "customer_portal_sessions_self_read" ON "customer_portal_sessions"
  FOR SELECT USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "portal_identity_id" = app_current_portal_identity_id()
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
  );
CREATE POLICY "customer_portal_sessions_internal_manage" ON "customer_portal_sessions"
  FOR ALL USING (
    app_current_actor_type() = 'INTERNAL_USER'
    AND "organization_id" = app_current_organization_id()
    AND (app_has_permission('customers.update') OR app_has_permission('*'))
  ) WITH CHECK (
    app_current_actor_type() = 'INTERNAL_USER'
    AND "organization_id" = app_current_organization_id()
    AND (app_has_permission('customers.update') OR app_has_permission('*'))
  );

CREATE POLICY "customer_portal_invitations_internal_manage" ON "customer_portal_invitations"
  FOR ALL USING (
    app_current_actor_type() = 'INTERNAL_USER'
    AND "organization_id" = app_current_organization_id()
    AND (app_has_permission('customers.update') OR app_has_permission('*'))
  ) WITH CHECK (
    app_current_actor_type() = 'INTERNAL_USER'
    AND "organization_id" = app_current_organization_id()
    AND (app_has_permission('customers.update') OR app_has_permission('*'))
  );

CREATE POLICY "customer_portal_password_resets_internal_read" ON "customer_portal_password_resets"
  FOR SELECT USING (
    app_current_actor_type() = 'INTERNAL_USER'
    AND "organization_id" = app_current_organization_id()
    AND (app_has_permission('customers.update') OR app_has_permission('*'))
  );

-- No direct policy is intentionally defined for rate limits. Public auth uses
-- the narrow SECURITY DEFINER function below; missing RLS context fails closed.

CREATE OR REPLACE FUNCTION app_customer_portal_consume_rate_limit(
  p_action text, p_scope_hash text, p_limit integer,
  p_window_seconds integer, p_block_seconds integer
) RETURNS TABLE("allowed" boolean, "retry_after_seconds" integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_row customer_portal_rate_limits%ROWTYPE;
BEGIN
  IF p_action !~ '^[A-Z_]{2,40}$' OR p_scope_hash !~ '^[0-9a-f]{64}$'
     OR p_limit < 1 OR p_window_seconds < 1 OR p_block_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit input' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('portal-rate:' || p_action || ':' || p_scope_hash));
  SELECT * INTO v_row FROM customer_portal_rate_limits
   WHERE action = p_action AND scope_hash = p_scope_hash FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO customer_portal_rate_limits
      (id, action, scope_hash, window_start, attempts, updated_at)
    VALUES (gen_random_uuid(), p_action, p_scope_hash, v_now, 1, v_now);
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;
  IF v_row.blocked_until IS NOT NULL AND v_row.blocked_until > v_now THEN
    RETURN QUERY SELECT false, GREATEST(1, ceil(extract(epoch FROM v_row.blocked_until - v_now))::int);
    RETURN;
  END IF;
  IF v_row.window_start + make_interval(secs => p_window_seconds) <= v_now THEN
    UPDATE customer_portal_rate_limits SET window_start = v_now, attempts = 1,
      blocked_until = NULL, updated_at = v_now WHERE id = v_row.id;
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;
  IF v_row.attempts + 1 > p_limit THEN
    UPDATE customer_portal_rate_limits SET attempts = attempts + 1,
      blocked_until = v_now + make_interval(secs => p_block_seconds), updated_at = v_now
      WHERE id = v_row.id;
    RETURN QUERY SELECT false, p_block_seconds;
    RETURN;
  END IF;
  UPDATE customer_portal_rate_limits SET attempts = attempts + 1, updated_at = v_now
    WHERE id = v_row.id;
  RETURN QUERY SELECT true, 0;
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_find_login(
  p_organization_slug text, p_normalized_email text
) RETURNS TABLE(
  "id" uuid, "organizationId" uuid, "customerId" uuid, "contactId" uuid,
  "email" text, "normalizedEmail" text, "displayName" text, "passwordHash" text,
  "status" text, "failedAttempts" integer, "lockedUntil" timestamptz,
  "emailVerifiedAt" timestamptz, "lastLoginAt" timestamptz, "disabledAt" timestamptz,
  "organizationSlug" text, "organizationName" text, "organizationStatus" text,
  "organizationDeletedAt" timestamptz, "customerName" text, "customerStatus" text,
  "customerDeletedAt" timestamptz
) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT i.id, i.organization_id, i.customer_id, i.contact_id, i.email::text,
    i.normalized_email::text, i.display_name::text, i.password_hash::text,
    i.status::text, i.failed_attempts, i.locked_until, i.email_verified_at,
    i.last_login_at, i.disabled_at, o.slug::text, o.display_name::text,
    o.status::text, o.deleted_at, COALESCE(c.trade_name, c.legal_name)::text,
    c.status::text, c.deleted_at
  FROM customer_portal_identities i
  JOIN organizations o ON o.id = i.organization_id
  JOIN customers c ON c.id = i.customer_id AND c.organization_id = i.organization_id
  WHERE o.slug = p_organization_slug AND i.normalized_email = p_normalized_email
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_record_failed_login(p_identity_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_org uuid;
  v_attempts integer;
BEGIN
  UPDATE customer_portal_identities SET
    failed_attempts = failed_attempts + 1,
    locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN clock_timestamp() + interval '15 minutes' ELSE locked_until END,
    updated_at = clock_timestamp()
  WHERE id = p_identity_id
  RETURNING organization_id, failed_attempts INTO v_org, v_attempts;
  IF v_attempts = 5 THEN
    INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
    VALUES (gen_random_uuid(), v_org, 'customer.portal.login.locked',
      'CUSTOMER_PORTAL_IDENTITY', p_identity_id,
      jsonb_build_object('actorType', 'CUSTOMER_PORTAL', 'reason', 'FAILED_ATTEMPT_THRESHOLD'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_create_session(
  p_session_id uuid, p_identity_id uuid, p_refresh_hash text,
  p_user_agent text, p_ip_address inet, p_expires_at timestamptz
) RETURNS TABLE(
  "id" uuid, "organizationId" uuid, "customerId" uuid, "contactId" uuid,
  "email" text, "normalizedEmail" text, "displayName" text, "passwordHash" text,
  "status" text, "failedAttempts" integer, "lockedUntil" timestamptz,
  "emailVerifiedAt" timestamptz, "lastLoginAt" timestamptz, "disabledAt" timestamptz,
  "organizationSlug" text, "organizationName" text, "organizationStatus" text,
  "organizationDeletedAt" timestamptz, "customerName" text, "customerStatus" text,
  "customerDeletedAt" timestamptz, "sessionId" uuid,
  "sessionExpiresAt" timestamptz, "sessionRevokedAt" timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_refresh_hash !~ '^[0-9a-f]{64}$' OR p_expires_at <= clock_timestamp() THEN
    RETURN;
  END IF;
  INSERT INTO customer_portal_sessions
    (id, organization_id, customer_id, portal_identity_id, refresh_token_hash,
     user_agent, ip_address, expires_at)
  SELECT p_session_id, i.organization_id, i.customer_id, i.id, p_refresh_hash,
    p_user_agent, p_ip_address, p_expires_at
  FROM customer_portal_identities i
  JOIN organizations o ON o.id = i.organization_id
  JOIN customers c ON c.id = i.customer_id AND c.organization_id = i.organization_id
  WHERE i.id = p_identity_id AND i.status = 'ACTIVE' AND i.disabled_at IS NULL
    AND i.password_hash IS NOT NULL AND o.status = 'ACTIVE' AND o.deleted_at IS NULL
    AND c.status = 'ACTIVE' AND c.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE customer_portal_identities SET failed_attempts = 0, locked_until = NULL,
    last_login_at = clock_timestamp(), updated_at = clock_timestamp()
  WHERE customer_portal_identities.id = p_identity_id;
  INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
  SELECT gen_random_uuid(), i.organization_id, 'customer.portal.login.succeeded',
    'CUSTOMER_PORTAL_IDENTITY', i.id, jsonb_build_object('actorType', 'CUSTOMER_PORTAL')
  FROM customer_portal_identities i WHERE i.id = p_identity_id;
  RETURN QUERY
  SELECT i.id, i.organization_id, i.customer_id, i.contact_id, i.email::text,
    i.normalized_email::text, i.display_name::text, i.password_hash::text,
    i.status::text, i.failed_attempts, i.locked_until, i.email_verified_at,
    i.last_login_at, i.disabled_at, o.slug::text, o.display_name::text,
    o.status::text, o.deleted_at, COALESCE(c.trade_name, c.legal_name)::text,
    c.status::text, c.deleted_at, s.id, s.expires_at, s.revoked_at
  FROM customer_portal_sessions s JOIN customer_portal_identities i ON i.id = s.portal_identity_id
  JOIN organizations o ON o.id = i.organization_id JOIN customers c ON c.id = i.customer_id
  WHERE s.id = p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_resolve_session(
  p_session_id uuid, p_identity_id uuid
) RETURNS TABLE(
  "id" uuid, "organizationId" uuid, "customerId" uuid, "contactId" uuid,
  "email" text, "normalizedEmail" text, "displayName" text, "passwordHash" text,
  "status" text, "failedAttempts" integer, "lockedUntil" timestamptz,
  "emailVerifiedAt" timestamptz, "lastLoginAt" timestamptz, "disabledAt" timestamptz,
  "organizationSlug" text, "organizationName" text, "organizationStatus" text,
  "organizationDeletedAt" timestamptz, "customerName" text, "customerStatus" text,
  "customerDeletedAt" timestamptz, "sessionId" uuid,
  "sessionExpiresAt" timestamptz, "sessionRevokedAt" timestamptz
) LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.id, i.organization_id, i.customer_id, i.contact_id, i.email::text,
    i.normalized_email::text, i.display_name::text, i.password_hash::text,
    i.status::text, i.failed_attempts, i.locked_until, i.email_verified_at,
    i.last_login_at, i.disabled_at, o.slug::text, o.display_name::text,
    o.status::text, o.deleted_at, COALESCE(c.trade_name, c.legal_name)::text,
    c.status::text, c.deleted_at, s.id, s.expires_at, s.revoked_at
  FROM customer_portal_sessions s JOIN customer_portal_identities i ON i.id = s.portal_identity_id
  JOIN organizations o ON o.id = i.organization_id JOIN customers c ON c.id = i.customer_id AND c.organization_id = i.organization_id
  WHERE s.id = p_session_id AND i.id = p_identity_id AND s.revoked_at IS NULL
    AND s.expires_at > clock_timestamp() AND i.status = 'ACTIVE' AND i.disabled_at IS NULL
    AND o.status = 'ACTIVE' AND o.deleted_at IS NULL AND c.status = 'ACTIVE' AND c.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_find_refresh(p_refresh_hash text)
RETURNS TABLE(
  "id" uuid, "organizationId" uuid, "customerId" uuid, "contactId" uuid,
  "email" text, "normalizedEmail" text, "displayName" text, "passwordHash" text,
  "status" text, "failedAttempts" integer, "lockedUntil" timestamptz,
  "emailVerifiedAt" timestamptz, "lastLoginAt" timestamptz, "disabledAt" timestamptz,
  "organizationSlug" text, "organizationName" text, "organizationStatus" text,
  "organizationDeletedAt" timestamptz, "customerName" text, "customerStatus" text,
  "customerDeletedAt" timestamptz, "sessionId" uuid,
  "sessionExpiresAt" timestamptz, "sessionRevokedAt" timestamptz,
  "refreshTokenHash" text
) LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT i.id, i.organization_id, i.customer_id, i.contact_id, i.email::text,
    i.normalized_email::text, i.display_name::text, i.password_hash::text,
    i.status::text, i.failed_attempts, i.locked_until, i.email_verified_at,
    i.last_login_at, i.disabled_at, o.slug::text, o.display_name::text,
    o.status::text, o.deleted_at, COALESCE(c.trade_name, c.legal_name)::text,
    c.status::text, c.deleted_at, s.id, s.expires_at, s.revoked_at, s.refresh_token_hash::text
  FROM customer_portal_sessions s JOIN customer_portal_identities i ON i.id = s.portal_identity_id
  JOIN organizations o ON o.id = i.organization_id JOIN customers c ON c.id = i.customer_id AND c.organization_id = i.organization_id
  WHERE s.refresh_token_hash = p_refresh_hash AND s.revoked_at IS NULL
    AND s.expires_at > clock_timestamp() AND i.status = 'ACTIVE' AND i.disabled_at IS NULL
    AND o.status = 'ACTIVE' AND o.deleted_at IS NULL AND c.status = 'ACTIVE' AND c.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_rotate_session(
  p_session_id uuid, p_current_hash text, p_next_hash text, p_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE customer_portal_sessions SET refresh_token_hash = p_next_hash,
    expires_at = p_expires_at, last_seen_at = clock_timestamp()
  WHERE id = p_session_id AND refresh_token_hash = p_current_hash
    AND revoked_at IS NULL AND expires_at > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_revoke_session(p_session_id uuid, p_identity_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_org uuid;
BEGIN
  UPDATE customer_portal_sessions SET revoked_at = clock_timestamp()
   WHERE id = p_session_id AND portal_identity_id = p_identity_id AND revoked_at IS NULL
   RETURNING organization_id INTO v_org;
  IF FOUND THEN
    INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
    VALUES (gen_random_uuid(), v_org, 'customer.portal.session.revoked', 'CUSTOMER_PORTAL_IDENTITY',
      p_identity_id, jsonb_build_object('actorType', 'CUSTOMER_PORTAL'));
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_activate_invitation(p_token_hash text, p_password_hash text)
RETURNS TABLE(
  "id" uuid, "organizationId" uuid, "customerId" uuid, "contactId" uuid,
  "email" text, "normalizedEmail" text, "displayName" text, "passwordHash" text,
  "status" text, "failedAttempts" integer, "lockedUntil" timestamptz,
  "emailVerifiedAt" timestamptz, "lastLoginAt" timestamptz, "disabledAt" timestamptz,
  "organizationSlug" text, "organizationName" text, "organizationStatus" text,
  "organizationDeletedAt" timestamptz, "customerName" text, "customerStatus" text,
  "customerDeletedAt" timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_inv customer_portal_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM customer_portal_invitations
   WHERE token_hash = p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL
     AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE customer_portal_identities SET password_hash = p_password_hash, status = 'ACTIVE',
    email_verified_at = clock_timestamp(), password_updated_at = clock_timestamp(),
    failed_attempts = 0, locked_until = NULL, disabled_at = NULL, updated_at = clock_timestamp()
   WHERE customer_portal_identities.id = v_inv.portal_identity_id AND status = 'INVITED';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE customer_portal_invitations SET accepted_at = clock_timestamp()
   WHERE customer_portal_invitations.id = v_inv.id;
  INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), v_inv.organization_id,
    'customer.portal.identity.activated', 'CUSTOMER_PORTAL_IDENTITY', v_inv.portal_identity_id,
    jsonb_build_object('actorType', 'CUSTOMER_PORTAL'));
  RETURN QUERY SELECT * FROM app_customer_portal_find_login(
    (SELECT slug::text FROM organizations WHERE organizations.id = v_inv.organization_id),
    (SELECT normalized_email::text FROM customer_portal_identities WHERE customer_portal_identities.id = v_inv.portal_identity_id));
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_create_password_reset(
  p_organization_slug text, p_normalized_email text, p_reset_id uuid,
  p_token_hash text, p_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_identity customer_portal_identities%ROWTYPE;
BEGIN
  SELECT i.* INTO v_identity FROM customer_portal_identities i
  JOIN organizations o ON o.id = i.organization_id
  JOIN customers c ON c.id = i.customer_id AND c.organization_id = i.organization_id
  WHERE o.slug = p_organization_slug AND i.normalized_email = p_normalized_email
    AND i.status = 'ACTIVE' AND i.disabled_at IS NULL AND o.status = 'ACTIVE'
    AND o.deleted_at IS NULL AND c.status = 'ACTIVE' AND c.deleted_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE customer_portal_password_resets SET used_at = clock_timestamp()
   WHERE portal_identity_id = v_identity.id AND used_at IS NULL;
  INSERT INTO customer_portal_password_resets
    (id, organization_id, customer_id, portal_identity_id, token_hash, expires_at)
  VALUES (p_reset_id, v_identity.organization_id, v_identity.customer_id,
    v_identity.id, p_token_hash, p_expires_at);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_consume_password_reset(p_token_hash text, p_password_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_reset customer_portal_password_resets%ROWTYPE;
BEGIN
  SELECT * INTO v_reset FROM customer_portal_password_resets
   WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > clock_timestamp()
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE customer_portal_identities SET password_hash = p_password_hash,
    password_updated_at = clock_timestamp(), failed_attempts = 0, locked_until = NULL,
    updated_at = clock_timestamp()
   WHERE id = v_reset.portal_identity_id AND status = 'ACTIVE' AND disabled_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE customer_portal_password_resets SET used_at = clock_timestamp() WHERE id = v_reset.id;
  UPDATE customer_portal_sessions SET revoked_at = clock_timestamp()
   WHERE portal_identity_id = v_reset.portal_identity_id AND revoked_at IS NULL;
  INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), v_reset.organization_id, 'customer.portal.password.reset',
    'CUSTOMER_PORTAL_IDENTITY', v_reset.portal_identity_id,
    jsonb_build_object('actorType', 'CUSTOMER_PORTAL'));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_change_password(
  p_identity_id uuid, p_keep_session_id uuid, p_password_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT organization_id INTO v_org FROM customer_portal_sessions
   WHERE id = p_keep_session_id AND portal_identity_id = p_identity_id
     AND revoked_at IS NULL AND expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE customer_portal_identities SET password_hash = p_password_hash,
    password_updated_at = clock_timestamp(), failed_attempts = 0, locked_until = NULL,
    updated_at = clock_timestamp() WHERE id = p_identity_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE customer_portal_sessions SET revoked_at = clock_timestamp()
   WHERE portal_identity_id = p_identity_id AND id <> p_keep_session_id AND revoked_at IS NULL;
  INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), v_org, 'customer.portal.password.changed',
    'CUSTOMER_PORTAL_IDENTITY', p_identity_id, jsonb_build_object('actorType', 'CUSTOMER_PORTAL'));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app_customer_portal_consume_rate_limit(text,text,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_find_login(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_record_failed_login(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_create_session(uuid,uuid,text,text,inet,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_resolve_session(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_find_refresh(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_rotate_session(uuid,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_revoke_session(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_activate_invitation(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_create_password_reset(text,text,uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_consume_password_reset(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_change_password(uuid,uuid,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_customer_portal_consume_rate_limit(text,text,integer,integer,integer) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_find_login(text,text) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_record_failed_login(uuid) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_create_session(uuid,uuid,text,text,inet,timestamptz) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_resolve_session(uuid,uuid) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_find_refresh(text) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_rotate_session(uuid,text,text,timestamptz) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_revoke_session(uuid,uuid) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_activate_invitation(text,text) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_create_password_reset(text,text,uuid,text,timestamptz) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_consume_password_reset(text,text) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_change_password(uuid,uuid,text) TO orbit_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_portal_identities" TO orbit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_portal_sessions" TO orbit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_portal_invitations" TO orbit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_portal_password_resets" TO orbit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_portal_rate_limits" TO orbit_app;
