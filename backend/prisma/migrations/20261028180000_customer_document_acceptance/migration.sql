CREATE TABLE quote_acceptance_links (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_unit_id uuid NOT NULL REFERENCES business_units(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE, quote_version timestamptz(3) NOT NULL,
  snapshot jsonb NOT NULL, document_file_id uuid NOT NULL REFERENCES storage_files(id),
  signature_file_id uuid REFERENCES storage_files(id),
  expires_at timestamptz(3) NOT NULL, revoked_at timestamptz(3),
  decision varchar(24), responded_at timestamptz(3), signer_name varchar(180),
  signer_document varchar(40), signer_email varchar(180), reason varchar(2000),
  response_ip varchar(64), response_user_agent varchar(400), consent_accepted boolean NOT NULL DEFAULT false,
  created_by_id uuid NOT NULL REFERENCES users(id), created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT quote_acceptance_response_complete CHECK (
    (decision IS NULL AND responded_at IS NULL AND signature_file_id IS NULL)
    OR (decision IS NOT NULL AND decision IN ('APPROVE','REJECT','REQUEST_CHANGES') AND responded_at IS NOT NULL AND COALESCE(length(btrim(signer_name)),0) >= 3
      AND (decision <> 'APPROVE' OR (signature_file_id IS NOT NULL AND consent_accepted))
      AND (decision = 'APPROVE' OR COALESCE(length(btrim(reason)),0) >= 5))
  )
);
CREATE INDEX quote_acceptance_links_organization_id_quote_id_created_at_idx ON quote_acceptance_links(organization_id,quote_id,created_at);
CREATE UNIQUE INDEX quote_acceptance_pending_unique ON quote_acceptance_links(quote_id) WHERE revoked_at IS NULL AND responded_at IS NULL;
ALTER TABLE quote_acceptance_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_acceptance_links FORCE ROW LEVEL SECURITY;
CREATE POLICY quote_acceptance_tenant ON quote_acceptance_links FOR ALL
  USING (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids()))
  WITH CHECK (organization_id=app_current_organization_id() AND business_unit_id=ANY(app_current_business_unit_ids()));
GRANT SELECT, INSERT, UPDATE, DELETE ON quote_acceptance_links TO orbit_app;

-- O token resolve somente o contexto de um orçamento. A aplicação revalida a
-- linha sob lock e executa os comandos existentes com RLS, sem assumir um usuário.
CREATE FUNCTION app_quote_acceptance_resolve(p_hash text)
RETURNS TABLE(link_id uuid, organization_id uuid, business_unit_id uuid, quote_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT l.id,l.organization_id,l.business_unit_id,l.quote_id
  FROM public.quote_acceptance_links l JOIN public.quotes q ON q.id=l.quote_id AND q.organization_id=l.organization_id
  WHERE p_hash ~ '^[0-9a-f]{64}$' AND l.token_hash=p_hash AND q.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION app_quote_acceptance_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_quote_acceptance_resolve(text) TO orbit_app;

ALTER TABLE pmoc_plan_signature_links ADD COLUMN public_summary jsonb,
  ADD COLUMN document_bucket varchar(160), ADD COLUMN document_object_key text,
  ADD COLUMN document_sha256 char(64);

CREATE FUNCTION app_pmoc_signature_document(p_hash text)
RETURNS TABLE(bucket text, object_key text, sha256 text, plan_code text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT l.document_bucket::text,l.document_object_key,l.document_sha256::text,
    COALESCE(l.public_summary->>'code',p.code)::text
  FROM public.pmoc_plan_signature_links l JOIN public.pmoc_plans p ON p.id=l.plan_id AND p.organization_id=l.organization_id
  WHERE p_hash ~ '^[0-9a-f]{64}$' AND l.token_hash=p_hash AND p.deleted_at IS NULL
    AND l.document_object_key IS NOT NULL
    AND (l.signed_at IS NOT NULL OR (l.revoked_at IS NULL AND l.expires_at>clock_timestamp()))
$$;
REVOKE ALL ON FUNCTION app_pmoc_signature_document(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pmoc_signature_document(text) TO orbit_app;

DROP FUNCTION app_pmoc_signature_link_read(text);
CREATE FUNCTION app_pmoc_signature_link_read(p_token_hash text)
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
  "expires_at"       timestamptz,
  "document_available" boolean
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
         COALESCE(v_link.public_summary->>'code',p.code)::text,
         COALESCE(v_link.public_summary->>'name',p.name)::text,
         COALESCE((v_link.public_summary->>'startsOn')::date,p.starts_on)::date,
         CASE WHEN v_link.public_summary IS NOT NULL THEN (v_link.public_summary->>'endsOn')::date ELSE p.ends_on END,
         COALESCE((v_link.public_summary->>'frequencyAmount')::integer,p.frequency_amount),
         COALESCE(v_link.public_summary->>'frequencyUnit',p.frequency_unit)::text,
         COALESCE(v_link.public_summary->>'customerName',c.trade_name,c.legal_name)::text,
         COALESCE(v_link.public_summary->>'emitterName',bu.trade_name,bu.legal_name)::text,
         COALESCE((v_link.public_summary->>'coveredEquipment')::integer,(SELECT COUNT(*)::int FROM pmoc_equipment_coverages cov WHERE cov.plan_id=p.id AND cov.deleted_at IS NULL)),
         CASE WHEN v_link.public_summary IS NOT NULL THEN v_link.public_summary->>'technicalResponsible' ELSE rt.display_name::text END,
         v_link.signer_name::text,
         v_link.signed_at,
         v_link.expires_at,
         v_link.document_object_key IS NOT NULL
    FROM pmoc_plans p
    JOIN customers c ON c.id = p.customer_id
    JOIN business_units bu ON bu.id = p.business_unit_id
    LEFT JOIN users rt ON rt.id = p.technical_responsible_user_id
   WHERE p.id = v_link.plan_id
     AND p.deleted_at IS NULL;
END;
$$;


REVOKE ALL ON FUNCTION app_pmoc_signature_link_read(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pmoc_signature_link_read(text) TO orbit_app;
