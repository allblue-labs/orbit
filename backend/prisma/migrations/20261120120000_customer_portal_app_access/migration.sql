-- ORBIT V2 — Área do cliente no app.
--
-- 1. O owner cria o acesso do cliente com senha temporária (como faz com a
--    equipe): a identidade nasce ACTIVE com `must_change_password`, e trocar a
--    senha é a primeira coisa que o cliente faz.
-- 2. Um acesso por cliente: no máximo uma identidade não desativada por
--    Customer.
-- 3. Login com e-mail e senha, sem slug: o domínio do e-mail já é o da
--    organização, e a função só responde quando o endereço é único na
--    instalação — ambíguo, ninguém entra por ele sem o slug.
-- 4. Foto e assinatura do cliente. Gravadas por função SECURITY DEFINER que
--    valida a própria sessão, no mesmo padrão da troca de senha: o ator do
--    portal continua sem policy de escrita na tabela de identidades.

ALTER TABLE "customer_portal_identities"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "avatar_bucket" VARCHAR(120),
  ADD COLUMN "avatar_object_key" VARCHAR(512),
  ADD COLUMN "avatar_updated_at" TIMESTAMPTZ(3),
  ADD COLUMN "signature_bucket" VARCHAR(120),
  ADD COLUMN "signature_object_key" VARCHAR(512),
  ADD COLUMN "signature_updated_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "customer_portal_identities_avatar_pair_check"
    CHECK (("avatar_bucket" IS NULL) = ("avatar_object_key" IS NULL)),
  ADD CONSTRAINT "customer_portal_identities_signature_pair_check"
    CHECK (("signature_bucket" IS NULL) = ("signature_object_key" IS NULL));

CREATE UNIQUE INDEX "customer_portal_identities_one_access_per_customer"
  ON "customer_portal_identities"("organization_id", "customer_id")
  WHERE "status" <> 'DISABLED';

-- Login sem slug. Delega à função existente para que as duas formas de entrar
-- devolvam exatamente a mesma linha e passem pelas mesmas verificações.
CREATE OR REPLACE FUNCTION app_customer_portal_find_login_by_email(
  p_normalized_email text
) RETURNS TABLE(
  "id" uuid, "organizationId" uuid, "customerId" uuid, "contactId" uuid,
  "email" text, "normalizedEmail" text, "displayName" text, "passwordHash" text,
  "status" text, "failedAttempts" integer, "lockedUntil" timestamptz,
  "emailVerifiedAt" timestamptz, "lastLoginAt" timestamptz, "disabledAt" timestamptz,
  "organizationSlug" text, "organizationName" text, "organizationStatus" text,
  "organizationDeletedAt" timestamptz, "customerName" text, "customerStatus" text,
  "customerDeletedAt" timestamptz
) LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
DECLARE v_count integer; v_slug text;
BEGIN
  SELECT count(*), min(o.slug::text) INTO v_count, v_slug
    FROM customer_portal_identities i
    JOIN organizations o ON o.id = i.organization_id
   WHERE i.normalized_email = p_normalized_email;
  IF v_count <> 1 THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM app_customer_portal_find_login(v_slug, p_normalized_email);
END;
$$;

-- Estado do perfil de quem tem sessão válida. Nada sai sem a sessão.
CREATE OR REPLACE FUNCTION app_customer_portal_profile_state(
  p_identity_id uuid, p_session_id uuid
) RETURNS TABLE(
  "mustChangePassword" boolean,
  "avatarBucket" text, "avatarObjectKey" text, "avatarUpdatedAt" timestamptz,
  "signatureBucket" text, "signatureObjectKey" text, "signatureUpdatedAt" timestamptz
) LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT i.must_change_password, i.avatar_bucket::text, i.avatar_object_key::text,
    i.avatar_updated_at, i.signature_bucket::text, i.signature_object_key::text,
    i.signature_updated_at
  FROM customer_portal_sessions s
  JOIN customer_portal_identities i ON i.id = s.portal_identity_id
  WHERE s.id = p_session_id AND i.id = p_identity_id
    AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
    AND i.status = 'ACTIVE' AND i.disabled_at IS NULL
$$;

-- Troca a foto ou a assinatura e devolve a anterior, para o storage ser limpo.
-- `p_object_key` nulo remove.
CREATE OR REPLACE FUNCTION app_customer_portal_set_media(
  p_identity_id uuid, p_session_id uuid, p_kind text,
  p_bucket text, p_object_key text
) RETURNS TABLE("previousBucket" text, "previousObjectKey" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_org uuid; v_prev_bucket text; v_prev_key text;
BEGIN
  IF p_kind NOT IN ('AVATAR', 'SIGNATURE') THEN RETURN; END IF;
  IF (p_bucket IS NULL) <> (p_object_key IS NULL) THEN RETURN; END IF;
  SELECT s.organization_id INTO v_org FROM customer_portal_sessions s
   WHERE s.id = p_session_id AND s.portal_identity_id = p_identity_id
     AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN; END IF;

  IF p_kind = 'AVATAR' THEN
    SELECT i.avatar_bucket::text, i.avatar_object_key::text INTO v_prev_bucket, v_prev_key
      FROM customer_portal_identities i
     WHERE i.id = p_identity_id AND i.status = 'ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE customer_portal_identities SET avatar_bucket = p_bucket,
      avatar_object_key = p_object_key,
      avatar_updated_at = CASE WHEN p_object_key IS NULL THEN NULL ELSE clock_timestamp() END,
      updated_at = clock_timestamp()
     WHERE customer_portal_identities.id = p_identity_id;
  ELSE
    SELECT i.signature_bucket::text, i.signature_object_key::text INTO v_prev_bucket, v_prev_key
      FROM customer_portal_identities i
     WHERE i.id = p_identity_id AND i.status = 'ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE customer_portal_identities SET signature_bucket = p_bucket,
      signature_object_key = p_object_key,
      signature_updated_at = CASE WHEN p_object_key IS NULL THEN NULL ELSE clock_timestamp() END,
      updated_at = clock_timestamp()
     WHERE customer_portal_identities.id = p_identity_id;
  END IF;

  INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), v_org,
    CASE WHEN p_kind = 'AVATAR' THEN
      CASE WHEN p_object_key IS NULL THEN 'customer.portal.avatar.removed' ELSE 'customer.portal.avatar.changed' END
    ELSE
      CASE WHEN p_object_key IS NULL THEN 'customer.portal.signature.removed' ELSE 'customer.portal.signature.changed' END
    END,
    'CUSTOMER_PORTAL_IDENTITY', p_identity_id, jsonb_build_object('actorType', 'CUSTOMER_PORTAL'));
  RETURN QUERY SELECT v_prev_bucket, v_prev_key;
END;
$$;

-- Trocar a senha cumpre a troca obrigatória. Mesma assinatura e corpo da
-- versão anterior, mais o `must_change_password = false`.
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
    must_change_password = false, updated_at = clock_timestamp()
   WHERE id = p_identity_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE customer_portal_sessions SET revoked_at = clock_timestamp()
   WHERE portal_identity_id = p_identity_id AND id <> p_keep_session_id AND revoked_at IS NULL;
  INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), v_org, 'customer.portal.password.changed',
    'CUSTOMER_PORTAL_IDENTITY', p_identity_id, jsonb_build_object('actorType', 'CUSTOMER_PORTAL'));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app_customer_portal_find_login_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_profile_state(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_set_media(uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_customer_portal_change_password(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_customer_portal_find_login_by_email(text) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_profile_state(uuid,uuid) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_set_media(uuid,uuid,text,text,text) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_customer_portal_change_password(uuid,uuid,text) TO orbit_app;
