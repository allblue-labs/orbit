BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.app_document_exports_in_progress(p_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_organization_id IS NULL OR (
    public.app_is_platform_admin() OR p_organization_id = public.app_current_organization_id()
  ) IS NOT TRUE THEN
    RAISE EXCEPTION 'DOCUMENT_EXPORTS_CROSS_TENANT' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT count(*)::integer FROM public.document_exports
    WHERE organization_id = p_organization_id AND status IN ('PENDING', 'PROCESSING'));
END $$;

-- Refuse inconsistent existing links before changing constraints. Keep the
-- transaction atomic and avoid disclosing object IDs in deployment output.
LOCK TABLE public.document_exports IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.document_exports e
      LEFT JOIN public.business_units u ON u.id=e.business_unit_id AND u.organization_id=e.organization_id
      LEFT JOIN public.background_jobs j ON j.id=e.job_id AND j.organization_id=e.organization_id
        AND j.business_unit_id IS NOT DISTINCT FROM e.business_unit_id
      LEFT JOIN public.storage_files f ON f.id=e.storage_file_id AND f.organization_id=e.organization_id
        AND f.business_unit_id IS NOT DISTINCT FROM e.business_unit_id
        AND f.metadata->>'documentExportId'=e.id::text
      LEFT JOIN public.quote_acceptance_links a ON a.id=e.acceptance_link_id AND a.organization_id=e.organization_id
        AND a.quote_id=e.entity_id AND a.business_unit_id=e.business_unit_id
    WHERE (e.business_unit_id IS NOT NULL AND u.id IS NULL)
       OR (e.job_id IS NOT NULL AND j.id IS NULL)
       OR (e.storage_file_id IS NOT NULL AND f.id IS NULL)
       OR (e.kind='QUOTE_ACCEPTED' AND a.id IS NULL)
       OR (e.kind<>'QUOTE_ACCEPTED' AND e.acceptance_link_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_EXPORT_SCOPE_PREFLIGHT_FAILED' USING ERRCODE = '23503';
  END IF;
END $$;

CREATE UNIQUE INDEX background_jobs_id_org_export_key
  ON public.background_jobs(id, organization_id);
CREATE UNIQUE INDEX quote_acceptance_links_export_scope_key
  ON public.quote_acceptance_links(id, organization_id, quote_id, business_unit_id);

ALTER TABLE public.document_exports
  DROP CONSTRAINT document_exports_business_unit_id_fkey,
  DROP CONSTRAINT document_exports_job_id_fkey,
  DROP CONSTRAINT document_exports_storage_file_id_fkey,
  DROP CONSTRAINT document_exports_accepted_has_link,
  ADD CONSTRAINT document_exports_unit_scope_fk
    FOREIGN KEY (business_unit_id, organization_id) REFERENCES public.business_units(id, organization_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT document_exports_job_scope_fk
    FOREIGN KEY (job_id, organization_id) REFERENCES public.background_jobs(id, organization_id) ON DELETE SET NULL (job_id) ON UPDATE RESTRICT,
  ADD CONSTRAINT document_exports_file_scope_fk
    FOREIGN KEY (storage_file_id, organization_id) REFERENCES public.storage_files(id, organization_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT document_exports_acceptance_scope_fk
    FOREIGN KEY (acceptance_link_id, organization_id, entity_id, business_unit_id)
    REFERENCES public.quote_acceptance_links(id, organization_id, quote_id, business_unit_id) ON DELETE CASCADE ON UPDATE RESTRICT,
  ADD CONSTRAINT document_exports_accepted_has_link CHECK (
    (kind='QUOTE_ACCEPTED' AND acceptance_link_id IS NOT NULL AND business_unit_id IS NOT NULL)
    OR (kind<>'QUOTE_ACCEPTED' AND acceptance_link_id IS NULL)
  );

-- Nullable unit columns cannot express equality with a MATCH SIMPLE FK.
-- Bind the job and generated file even when the export is organization-wide.
CREATE FUNCTION public.app_check_document_export_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NEW.job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.background_jobs j WHERE j.id=NEW.job_id
      AND j.organization_id=NEW.organization_id
      AND j.business_unit_id IS NOT DISTINCT FROM NEW.business_unit_id
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_EXPORT_JOB_SCOPE_INVALID' USING ERRCODE='23503';
  END IF;
  IF NEW.storage_file_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.storage_files f WHERE f.id=NEW.storage_file_id
      AND f.organization_id=NEW.organization_id
      AND f.business_unit_id IS NOT DISTINCT FROM NEW.business_unit_id
      AND f.metadata->>'documentExportId'=NEW.id::text
  ) THEN
    RAISE EXCEPTION 'DOCUMENT_EXPORT_FILE_SCOPE_INVALID' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.app_check_document_export_binding() FROM PUBLIC, orbit_app;
CREATE TRIGGER document_export_binding
  BEFORE INSERT OR UPDATE OF organization_id,business_unit_id,job_id,storage_file_id
  ON public.document_exports FOR EACH ROW EXECUTE FUNCTION public.app_check_document_export_binding();
COMMIT;
