-- Acesso anônimo ao contrato por token, pelo caminho estreito.
--
-- Quem abre o link não tem sessão: não há organização no contexto, e a política de
-- inquilino de `pmoc_plan_signature_links` não teria como ser satisfeita. A casa já
-- resolveu isso uma vez, no portal do cliente (PR-32): **nenhuma política anônima na
-- tabela**, e duas funções `SECURITY DEFINER` estreitas, que validam a entrada e só
-- fazem o que precisam. Contexto de RLS ausente falha fechado.
--
-- A credencial é o token. O que o chamador manda é o SHA-256 dele, e as funções
-- recusam qualquer coisa que não tenha essa forma — um `LIKE` acidental não varre a
-- tabela.

-- O contrato que o link abre.
--
-- Devolve o estado junto dos dados: a página pública precisa dizer **qual** problema
-- aconteceu — expirou, foi substituído, já foi assinado —, e decidir isso aqui evita
-- a aplicação reimplementar a mesma ordem de precedência.
CREATE OR REPLACE FUNCTION app_pmoc_signature_link_read(p_token_hash text)
RETURNS TABLE(
  "state"            text,
  "plan_code"        text,
  "plan_name"        text,
  "starts_on"        date,
  "ends_on"          date,
  "frequency_amount" integer,
  "frequency_unit"   text,
  "customer_name"    text,
  "emitter_name"     text,
  "covered_equipment" integer,
  "technical_responsible" text,
  "signer_name"      text,
  "signed_at"        timestamptz,
  "expires_at"       timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_link pmoc_plan_signature_links%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_state text;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid token' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link FROM pmoc_plan_signature_links
   WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A mesma precedência de `pmoc-signature-link.ts`: assinado é a verdade mais
  -- forte, depois revogado, depois a validade. Avaliar a expiração primeiro faria
  -- um contrato assinado na semana passada aparecer como "expirado".
  v_state := CASE
    WHEN v_link.signed_at IS NOT NULL THEN 'JA_ASSINADO'
    WHEN v_link.revoked_at IS NOT NULL THEN 'REVOGADO'
    WHEN v_link.expires_at <= v_now THEN 'EXPIRADO'
    ELSE 'VALIDO'
  END;

  RETURN QUERY
  SELECT v_state,
         p.code::text,
         p.name::text,
         p.starts_on::date,
         p.ends_on::date,
         p.frequency_amount,
         p.frequency_unit::text,
         COALESCE(c.trade_name, c.legal_name)::text,
         COALESCE(bu.trade_name, bu.legal_name)::text,
         (SELECT COUNT(*)::int FROM pmoc_equipment_coverages cov
           WHERE cov.plan_id = p.id)::int,
         rt.display_name::text,
         v_link.signer_name::text,
         v_link.signed_at,
         v_link.expires_at
    FROM pmoc_plans p
    JOIN customers c ON c.id = p.customer_id
    JOIN business_units bu ON bu.id = p.business_unit_id
    LEFT JOIN users rt ON rt.id = p.technical_responsible_user_id
   WHERE p.id = v_link.plan_id
     AND p.deleted_at IS NULL;
END;
$$;

-- A coleta da assinatura.
--
-- Uma função, e não três escritas na aplicação, porque as três precisam acontecer
-- juntas: o arquivo da assinatura, a marca de assinado e os dados de quem assinou. Em
-- passos separados, uma falha no meio deixaria um link "assinado" sem assinatura — o
-- `CHECK` da tabela recusa isso, e aqui a transação garante que nem se tente.
--
-- O bloqueio da linha é o que impede dois aceites simultâneos do mesmo link: o
-- segundo encontra `signed_at` preenchido e recebe `JA_ASSINADO`.
CREATE OR REPLACE FUNCTION app_pmoc_signature_link_sign(
  p_token_hash    text,
  p_signer_name   text,
  p_signer_document text,
  p_signer_email  text,
  p_ip            text,
  p_user_agent    text,
  p_bucket        text,
  p_object_key    text,
  p_mime_type     text,
  p_size_bytes    bigint,
  p_sha256        text
) RETURNS TABLE("state" text, "signed" boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_link pmoc_plan_signature_links%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_file_id uuid;
  v_org uuid;
  v_unit uuid;
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid token or digest' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_signer_name), '') = '' THEN
    RAISE EXCEPTION 'signer name is required' USING ERRCODE = '22023';
  END IF;
  IF p_size_bytes IS NULL OR p_size_bytes <= 0 THEN
    RAISE EXCEPTION 'signature file is empty' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_link FROM pmoc_plan_signature_links
   WHERE token_hash = p_token_hash
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'INEXISTENTE'::text, false;
    RETURN;
  END IF;

  IF v_link.signed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'JA_ASSINADO'::text, false;
    RETURN;
  END IF;
  IF v_link.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'REVOGADO'::text, false;
    RETURN;
  END IF;
  IF v_link.expires_at <= v_now THEN
    RETURN QUERY SELECT 'EXPIRADO'::text, false;
    RETURN;
  END IF;

  SELECT p.organization_id, p.business_unit_id INTO v_org, v_unit
    FROM pmoc_plans p WHERE p.id = v_link.plan_id AND p.deleted_at IS NULL;
  IF v_org IS NULL THEN
    RETURN QUERY SELECT 'INEXISTENTE'::text, false;
    RETURN;
  END IF;

  -- `created_by_id` fica nulo: quem assinou não é usuário da plataforma. É a mesma
  -- razão pela qual a coluna é opcional.
  v_file_id := gen_random_uuid();
  INSERT INTO storage_files (
    id, organization_id, business_unit_id, provider, bucket, object_key,
    file_name, mime_type, size_bytes, sha256, status, metadata,
    created_at, updated_at
  ) VALUES (
    v_file_id, v_org, v_unit, 'S3', p_bucket, p_object_key,
    'assinatura-contratante.png', p_mime_type, p_size_bytes, p_sha256,
    -- `AVAILABLE`, e não `READY`: é o vocabulário que `storage_files_status_check`
    -- aceita. O arquivo já está no bucket quando esta função roda — a aplicação
    -- sobe primeiro e só então registra, porque registrar um arquivo que não subiu
    -- deixaria o contrato apontando para um objeto inexistente.
    'AVAILABLE', jsonb_build_object('source', 'PMOC_CONTRACT_SIGNATURE'),
    v_now, v_now
  );

  UPDATE pmoc_plan_signature_links
     SET signed_at = v_now,
         signer_name = btrim(p_signer_name),
         signer_document = NULLIF(btrim(COALESCE(p_signer_document, '')), ''),
         signer_email = NULLIF(btrim(COALESCE(p_signer_email, '')), ''),
         signed_ip = NULLIF(btrim(COALESCE(p_ip, '')), ''),
         signed_user_agent = LEFT(NULLIF(btrim(COALESCE(p_user_agent, '')), ''), 400),
         signature_file_id = v_file_id,
         signature_sha256 = p_sha256,
         updated_at = v_now
   WHERE id = v_link.id;

  RETURN QUERY SELECT 'VALIDO'::text, true;
END;
$$;

REVOKE ALL ON FUNCTION app_pmoc_signature_link_read(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_pmoc_signature_link_sign(
  text, text, text, text, text, text, text, text, text, bigint, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pmoc_signature_link_read(text) TO orbit_app;
GRANT EXECUTE ON FUNCTION app_pmoc_signature_link_sign(
  text, text, text, text, text, text, text, text, text, bigint, text
) TO orbit_app;
