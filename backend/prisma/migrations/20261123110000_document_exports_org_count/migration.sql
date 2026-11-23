-- ORBIT V2 — Contagem de exportações em andamento da organização inteira.
--
-- `document_exports` é recortada por unidade no RLS: quem enxerga só a filial A
-- contava só os pendentes da filial A, e a organização podia passar do teto
-- global (20) somando pedidos de filiais diferentes. Esta função conta a
-- organização toda, mas apenas a do contexto da transação — nunca outra.
--
-- Devolve só um número: nenhum identificador, unidade ou conteúdo atravessa.

CREATE OR REPLACE FUNCTION app_document_exports_in_progress(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_organization_id IS NULL OR NOT (
    app_is_platform_admin() OR p_organization_id = app_current_organization_id()
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_EXPORTS_CROSS_TENANT' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT count(*)::integer
      FROM public.document_exports
     WHERE organization_id = p_organization_id
       AND status IN ('PENDING', 'PROCESSING')
  );
END $$;

REVOKE ALL ON FUNCTION app_document_exports_in_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_document_exports_in_progress(uuid) TO orbit_app;
