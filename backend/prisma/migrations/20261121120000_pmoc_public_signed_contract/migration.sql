-- ORBIT V2 — o contrato de PMOC assinado, também pelo link público.
--
-- O link servia sempre o PDF congelado no envio, sem a assinatura: quem
-- assinava baixava de novo e não via o próprio aceite, que só aparecia no
-- documento do owner. Esta função entrega ao link (e só a link já assinado) o
-- que falta para acrescentar a página de aceite ao PDF congelado: quem assinou,
-- quando, e onde está a imagem da assinatura com o hash gravado na assinatura.

CREATE FUNCTION app_pmoc_signature_acceptance(p_hash text)
RETURNS TABLE(
  signer_name text,
  signer_document text,
  signed_at timestamptz,
  signature_bucket text,
  signature_object_key text,
  signature_sha256 text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public AS $$
  SELECT l.signer_name::text, l.signer_document::text, l.signed_at,
    f.bucket::text, f.object_key::text, l.signature_sha256::text
  FROM public.pmoc_plan_signature_links l
  JOIN public.pmoc_plans p ON p.id = l.plan_id AND p.organization_id = l.organization_id
  JOIN public.storage_files f ON f.id = l.signature_file_id
    AND f.organization_id = l.organization_id
  WHERE p_hash ~ '^[0-9a-f]{64}$' AND l.token_hash = p_hash
    AND l.signed_at IS NOT NULL AND l.signer_name IS NOT NULL
    AND p.deleted_at IS NULL
    AND f.status = 'AVAILABLE' AND f.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION app_pmoc_signature_acceptance(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pmoc_signature_acceptance(text) TO orbit_app;
