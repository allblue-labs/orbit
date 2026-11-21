-- ORBIT V2 — Entrar com a biometria do aparelho.
--
-- Duas formas de credencial, nos dois mundos (equipe e cliente):
--
-- * WEBAUTHN — a web. O navegador cria um par de chaves protegido pela
--   biometria do aparelho (Touch ID, Windows Hello, digital do Android). O
--   servidor guarda só a chave PÚBLICA; entrar é provar posse da privada
--   assinando um desafio de uso único. Nada secreto sai do aparelho.
-- * DEVICE — o app. Um segredo aleatório que o app guarda no armazenamento
--   seguro e só libera depois da biometria nativa. O servidor guarda só o
--   SHA-256, e o segredo é TROCADO a cada uso (compare-and-swap): um segredo
--   copiado vale no máximo até o próximo uso legítimo.
--
-- A sessão que sai daqui é a mesma do login com senha. Credencial revogada,
-- conta desativada ou cliente inativo recusam como sempre.

-- Equipe: sem RLS, como `credentials` e `sessions` — o login não tem contexto
-- de organização, e a autorização é a posse da credencial.
CREATE TABLE "identity_biometric_credentials" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "device_id" VARCHAR(120),
  "secret_hash" CHAR(64),
  "webauthn_credential_id" VARCHAR(1024),
  "public_key" BYTEA,
  "sign_count" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT[] NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "identity_biometric_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "identity_biometric_credentials_user_fkey" FOREIGN KEY ("user_id")
    REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "identity_biometric_kind_check" CHECK (
    ("kind" = 'DEVICE' AND "secret_hash" ~ '^[0-9a-f]{64}$' AND "webauthn_credential_id" IS NULL)
    OR ("kind" = 'WEBAUTHN' AND "webauthn_credential_id" IS NOT NULL AND "public_key" IS NOT NULL AND "secret_hash" IS NULL)
  )
);
CREATE UNIQUE INDEX "identity_biometric_webauthn_key"
  ON "identity_biometric_credentials"("webauthn_credential_id")
  WHERE "webauthn_credential_id" IS NOT NULL;
CREATE UNIQUE INDEX "identity_biometric_device_active_key"
  ON "identity_biometric_credentials"("user_id", "device_id")
  WHERE "kind" = 'DEVICE' AND "revoked_at" IS NULL;
CREATE INDEX "identity_biometric_user_idx"
  ON "identity_biometric_credentials"("user_id", "revoked_at");

-- Cliente: a mesma forma, com o escopo do portal, RLS forçado e acesso só
-- pelas funções abaixo — o padrão de toda tabela do portal.
CREATE TABLE "customer_portal_biometric_credentials" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "portal_identity_id" UUID NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "device_id" VARCHAR(120),
  "secret_hash" CHAR(64),
  "webauthn_credential_id" VARCHAR(1024),
  "public_key" BYTEA,
  "sign_count" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT[] NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "customer_portal_biometric_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_portal_biometric_identity_fkey" FOREIGN KEY ("portal_identity_id")
    REFERENCES "customer_portal_identities"("id") ON DELETE CASCADE,
  CONSTRAINT "portal_biometric_kind_check" CHECK (
    ("kind" = 'DEVICE' AND "secret_hash" ~ '^[0-9a-f]{64}$' AND "webauthn_credential_id" IS NULL)
    OR ("kind" = 'WEBAUTHN' AND "webauthn_credential_id" IS NOT NULL AND "public_key" IS NOT NULL AND "secret_hash" IS NULL)
  )
);
CREATE UNIQUE INDEX "portal_biometric_webauthn_key"
  ON "customer_portal_biometric_credentials"("webauthn_credential_id")
  WHERE "webauthn_credential_id" IS NOT NULL;
CREATE UNIQUE INDEX "portal_biometric_device_active_key"
  ON "customer_portal_biometric_credentials"("portal_identity_id", "device_id")
  WHERE "kind" = 'DEVICE' AND "revoked_at" IS NULL;

ALTER TABLE "customer_portal_biometric_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_portal_biometric_credentials" FORCE ROW LEVEL SECURITY;
-- Nenhuma policy: sem contexto, nada passa. Tudo pelas funções.

-- Desafios WebAuthn: um uso, poucos minutos. Sem RLS — não guardam segredo,
-- e o login público precisa consumi-los sem contexto.
CREATE TABLE "auth_challenges" (
  "id" UUID NOT NULL,
  "purpose" VARCHAR(40) NOT NULL,
  "challenge" VARCHAR(200) NOT NULL,
  "subject_id" UUID,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_challenges_purpose_check" CHECK ("purpose" IN (
    'USER_REGISTER','USER_LOGIN','PORTAL_REGISTER','PORTAL_LOGIN'
  ))
);
CREATE INDEX "auth_challenges_expiry_idx" ON "auth_challenges"("expires_at");

GRANT SELECT, INSERT, UPDATE, DELETE ON "identity_biometric_credentials" TO orbit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_portal_biometric_credentials" TO orbit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_challenges" TO orbit_app;

/* ---------------------------------------------------------------- */
/* Funções do portal                                                 */
/* ---------------------------------------------------------------- */

-- Cadastra uma credencial para a sessão válida da própria identidade.
CREATE OR REPLACE FUNCTION app_customer_portal_biometric_register(
  p_identity_id uuid, p_session_id uuid, p_id uuid, p_kind text, p_label text,
  p_device_id text, p_secret_hash text, p_webauthn_id text, p_public_key bytea,
  p_sign_count bigint, p_transports text[]
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_org uuid; v_customer uuid;
BEGIN
  SELECT s.organization_id, s.customer_id INTO v_org, v_customer
    FROM customer_portal_sessions s
    JOIN customer_portal_identities i ON i.id = s.portal_identity_id
   WHERE s.id = p_session_id AND s.portal_identity_id = p_identity_id
     AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
     AND i.status = 'ACTIVE';
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_kind = 'DEVICE' THEN
    UPDATE customer_portal_biometric_credentials SET revoked_at = clock_timestamp()
     WHERE portal_identity_id = p_identity_id AND kind = 'DEVICE'
       AND device_id = p_device_id AND revoked_at IS NULL;
  END IF;
  INSERT INTO customer_portal_biometric_credentials
    (id, organization_id, customer_id, portal_identity_id, kind, label, device_id,
     secret_hash, webauthn_credential_id, public_key, sign_count, transports)
  VALUES (p_id, v_org, v_customer, p_identity_id, p_kind, p_label, p_device_id,
     p_secret_hash, p_webauthn_id, p_public_key, COALESCE(p_sign_count, 0),
     COALESCE(p_transports, '{}'));
  INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), v_org, 'customer.portal.biometric.enrolled',
    'CUSTOMER_PORTAL_IDENTITY', p_identity_id,
    jsonb_build_object('actorType', 'CUSTOMER_PORTAL', 'kind', p_kind));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_biometric_list(
  p_identity_id uuid, p_session_id uuid
) RETURNS TABLE("id" uuid, "kind" text, "label" text, "createdAt" timestamptz, "lastUsedAt" timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT c.id, c.kind::text, c.label::text, c.created_at, c.last_used_at
    FROM customer_portal_biometric_credentials c
   WHERE c.portal_identity_id = p_identity_id AND c.revoked_at IS NULL
     AND EXISTS (
       SELECT 1 FROM customer_portal_sessions s
        WHERE s.id = p_session_id AND s.portal_identity_id = p_identity_id
          AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp())
   ORDER BY c.created_at DESC
$$;

CREATE OR REPLACE FUNCTION app_customer_portal_biometric_revoke(
  p_identity_id uuid, p_session_id uuid, p_credential_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM 1 FROM customer_portal_sessions s
   WHERE s.id = p_session_id AND s.portal_identity_id = p_identity_id
     AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE customer_portal_biometric_credentials SET revoked_at = clock_timestamp()
   WHERE id = p_credential_id AND portal_identity_id = p_identity_id AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

-- Login: a credencial ativa, para o serviço conferir segredo ou assinatura.
CREATE OR REPLACE FUNCTION app_customer_portal_biometric_lookup(
  p_credential_id uuid, p_webauthn_id text
) RETURNS TABLE(
  "id" uuid, "identityId" uuid, "kind" text, "secretHash" text,
  "publicKey" bytea, "signCount" bigint, "transports" text[],
  "webauthnId" text
) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT c.id, c.portal_identity_id, c.kind::text, c.secret_hash::text,
         c.public_key, c.sign_count, c.transports, c.webauthn_credential_id::text
    FROM customer_portal_biometric_credentials c
   WHERE c.revoked_at IS NULL
     AND ((p_credential_id IS NOT NULL AND c.id = p_credential_id)
       OR (p_webauthn_id IS NOT NULL AND c.webauthn_credential_id = p_webauthn_id))
   LIMIT 1
$$;

-- Marca o uso. DEVICE troca o segredo só se o antigo ainda for o atual:
-- duas tentativas com o mesmo segredo, só uma vence.
CREATE OR REPLACE FUNCTION app_customer_portal_biometric_use(
  p_credential_id uuid, p_expected_secret_hash text, p_new_secret_hash text,
  p_sign_count bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE customer_portal_biometric_credentials
     SET secret_hash = COALESCE(p_new_secret_hash, secret_hash),
         sign_count = COALESCE(p_sign_count, sign_count),
         last_used_at = clock_timestamp()
   WHERE id = p_credential_id AND revoked_at IS NULL
     AND (p_expected_secret_hash IS NULL OR secret_hash = p_expected_secret_hash);
  RETURN FOUND;
END;
$$;

-- A linha de login de uma identidade — a mesma de `find_login`, para a
-- biometria passar pelas mesmas verificações de elegibilidade.
CREATE OR REPLACE FUNCTION app_customer_portal_login_by_identity(p_identity_id uuid)
RETURNS TABLE(
  "id" uuid, "organizationId" uuid, "customerId" uuid, "contactId" uuid,
  "email" text, "normalizedEmail" text, "displayName" text, "passwordHash" text,
  "status" text, "failedAttempts" integer, "lockedUntil" timestamptz,
  "emailVerifiedAt" timestamptz, "lastLoginAt" timestamptz, "disabledAt" timestamptz,
  "organizationSlug" text, "organizationName" text, "organizationStatus" text,
  "organizationDeletedAt" timestamptz, "customerName" text, "customerStatus" text,
  "customerDeletedAt" timestamptz
) LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
DECLARE v_slug text; v_email text;
BEGIN
  SELECT o.slug::text, i.normalized_email::text INTO v_slug, v_email
    FROM customer_portal_identities i JOIN organizations o ON o.id = i.organization_id
   WHERE i.id = p_identity_id AND NOT i.must_change_password;
  -- Senha temporária pendente (o owner gerou uma nova): entra com ela.
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM app_customer_portal_find_login(v_slug, v_email);
END;
$$;

REVOKE ALL ON FUNCTION app_customer_portal_biometric_register(uuid,uuid,uuid,text,text,text,text,text,bytea,bigint,text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_biometric_list(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_biometric_revoke(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_biometric_lookup(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_biometric_use(uuid,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_login_by_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_customer_portal_biometric_register(uuid,uuid,uuid,text,text,text,text,text,bytea,bigint,text[]) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_biometric_list(uuid,uuid) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_biometric_revoke(uuid,uuid,uuid) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_biometric_lookup(uuid,text) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_biometric_use(uuid,text,text,bigint) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_login_by_identity(uuid) TO orbit_app;
