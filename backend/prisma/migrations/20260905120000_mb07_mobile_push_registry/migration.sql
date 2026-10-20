ALTER TABLE "notifications" ADD COLUMN "dedupe_key" VARCHAR(180);
CREATE UNIQUE INDEX "notifications_org_dedupe_key"
  ON "notifications"("organization_id", "dedupe_key")
  WHERE "dedupe_key" IS NOT NULL;

CREATE TABLE "mobile_device_installations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "device_instance_id" VARCHAR(120) NOT NULL,
  "platform" VARCHAR(20) NOT NULL,
  "push_provider" VARCHAR(30) NOT NULL,
  "push_token" TEXT NOT NULL,
  "push_token_hash" CHAR(64) NOT NULL,
  "app_version" VARCHAR(40) NOT NULL,
  "os_version" VARCHAR(60),
  "locale" VARCHAR(16),
  "timezone" VARCHAR(64),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "token_updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mobile_device_installations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mobile_device_installations_platform_check" CHECK ("platform" IN ('IOS','ANDROID')),
  CONSTRAINT "mobile_device_installations_provider_check" CHECK ("push_provider" IN ('FCM','APNS')),
  CONSTRAINT "mobile_device_installations_token_hash_check" CHECK ("push_token_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "mobile_device_installations_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "mobile_device_installations_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "mobile_device_installations_device_key"
  ON "mobile_device_installations"("device_instance_id");
CREATE UNIQUE INDEX "mobile_device_installations_active_token_key"
  ON "mobile_device_installations"("push_token_hash")
  WHERE "enabled" = true AND "revoked_at" IS NULL;
CREATE INDEX "mobile_device_installations_user_active_idx"
  ON "mobile_device_installations"("organization_id", "user_id", "enabled", "revoked_at");

CREATE TABLE "mobile_push_deliveries" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "installation_id" UUID NOT NULL,
  "status" VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  "provider" VARCHAR(40),
  "provider_message_id" VARCHAR(255),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(80),
  "accepted_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mobile_push_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mobile_push_deliveries_status_check" CHECK ("status" IN ('PENDING','ACCEPTED_BY_PROVIDER','INVALID_TOKEN','PERMANENT_FAILURE','TEMPORARY_FAILURE','SKIPPED')),
  CONSTRAINT "mobile_push_deliveries_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "mobile_push_deliveries_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "mobile_push_deliveries_notification_fk" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE,
  CONSTRAINT "mobile_push_deliveries_installation_fk" FOREIGN KEY ("installation_id") REFERENCES "mobile_device_installations"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "mobile_push_deliveries_notification_installation_key"
  ON "mobile_push_deliveries"("notification_id", "installation_id");
CREATE INDEX "mobile_push_deliveries_org_status_created_idx"
  ON "mobile_push_deliveries"("organization_id", "status", "created_at");
CREATE INDEX "mobile_push_deliveries_installation_created_idx"
  ON "mobile_push_deliveries"("installation_id", "created_at");

ALTER TABLE "mobile_device_installations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_device_installations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "mobile_push_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_push_deliveries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "mobile_device_installations_owner_scope" ON "mobile_device_installations"
  USING (
    "organization_id" = app_current_organization_id()
    AND "user_id" = app_current_user_id()
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND "user_id" = app_current_user_id()
  );

CREATE POLICY "mobile_push_deliveries_recipient_scope" ON "mobile_push_deliveries"
  USING (
    "organization_id" = app_current_organization_id()
    AND EXISTS (
      SELECT 1 FROM "notifications" n
       WHERE n."id" = "notification_id"
         AND n."organization_id" = app_current_organization_id()
         AND n."recipient_user_id" = app_current_user_id()
    )
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND EXISTS (
      SELECT 1 FROM "notifications" n
       WHERE n."id" = "notification_id"
         AND n."organization_id" = app_current_organization_id()
         AND n."recipient_user_id" = app_current_user_id()
    )
  );

-- Boundary estreito para login/user-switch: a função deriva org e usuário
-- exclusivamente do RequestContext e nunca aceita essas autoridades do app.
CREATE OR REPLACE FUNCTION app_register_mobile_installation(
  p_id uuid,
  p_device_instance_id varchar,
  p_platform varchar,
  p_push_provider varchar,
  p_push_token text,
  p_push_token_hash char(64),
  p_app_version varchar,
  p_os_version varchar,
  p_locale varchar,
  p_timezone varchar
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_org uuid := app_current_organization_id();
  v_user uuid := app_current_user_id();
  v_id uuid;
BEGIN
  IF v_org IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'mobile installation context missing' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_memberships
     WHERE organization_id = v_org AND user_id = v_user
       AND status = 'ACTIVE' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'mobile installation membership denied' USING ERRCODE = '42501';
  END IF;

  UPDATE mobile_device_installations
     SET enabled = false, revoked_at = now(), updated_at = now()
   WHERE push_token_hash = p_push_token_hash
     AND device_instance_id <> p_device_instance_id
     AND enabled = true AND revoked_at IS NULL;

  INSERT INTO mobile_device_installations (
    id, organization_id, user_id, device_instance_id, platform, push_provider,
    push_token, push_token_hash, app_version, os_version, locale, timezone,
    enabled, last_seen_at, token_updated_at, revoked_at, updated_at
  ) VALUES (
    p_id, v_org, v_user, p_device_instance_id, p_platform, p_push_provider,
    p_push_token, p_push_token_hash, p_app_version, p_os_version, p_locale,
    p_timezone, true, now(), now(), NULL, now()
  )
  ON CONFLICT (device_instance_id) DO UPDATE SET
    organization_id = v_org,
    user_id = v_user,
    platform = EXCLUDED.platform,
    push_provider = EXCLUDED.push_provider,
    push_token = EXCLUDED.push_token,
    push_token_hash = EXCLUDED.push_token_hash,
    app_version = EXCLUDED.app_version,
    os_version = EXCLUDED.os_version,
    locale = EXCLUDED.locale,
    timezone = EXCLUDED.timezone,
    enabled = true,
    last_seen_at = now(),
    token_updated_at = CASE
      WHEN mobile_device_installations.push_token_hash <> EXCLUDED.push_token_hash THEN now()
      ELSE mobile_device_installations.token_updated_at
    END,
    revoked_at = NULL,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION app_register_mobile_installation(uuid,varchar,varchar,varchar,text,char(64),varchar,varchar,varchar,varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_register_mobile_installation(uuid,varchar,varchar,varchar,text,char(64),varchar,varchar,varchar,varchar) TO orbit_app;
GRANT SELECT, INSERT, UPDATE ON "mobile_device_installations" TO orbit_app;
GRANT SELECT, INSERT, UPDATE ON "mobile_push_deliveries" TO orbit_app;
