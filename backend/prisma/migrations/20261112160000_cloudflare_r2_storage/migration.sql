-- Keep historical provider values readable while local objects are migrated.
ALTER TABLE storage_files DROP CONSTRAINT storage_files_provider_check;
ALTER TABLE storage_files ADD CONSTRAINT storage_files_provider_check
  CHECK (provider IN ('LOCAL','S3','MINIO','AZURE_BLOB','GCS','R2'));

CREATE POLICY storage_deletion_tenant_enqueue ON storage_deletion_jobs FOR INSERT
  WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid);

-- Public PMOC signature tokens confer access to a single contract, never a
-- platform-admin tenant context. Keep the original function for old clients.
CREATE FUNCTION app_pmoc_signature_upload_scope(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_org uuid;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  SELECT l.organization_id INTO v_org FROM pmoc_plan_signature_links l
    JOIN pmoc_plans p ON p.id=l.plan_id
    WHERE l.token_hash=p_token_hash AND l.revoked_at IS NULL AND l.signed_at IS NULL
      AND l.expires_at>clock_timestamp() AND p.deleted_at IS NULL AND p.status<>'CANCELLED';
  RETURN v_org;
END $$;
REVOKE ALL ON FUNCTION app_pmoc_signature_upload_scope(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pmoc_signature_upload_scope(text) TO orbit_app;

CREATE FUNCTION app_pmoc_signature_link_sign_storage(
  p_token_hash text, p_signer_name text, p_signer_document text,
  p_signer_email text, p_ip text, p_user_agent text, p_bucket text,
  p_object_key text, p_mime_type text, p_size_bytes bigint, p_sha256 text,
  p_provider text
) RETURNS TABLE("state" text, "signed" boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_state text; v_signed boolean;
BEGIN
  IF p_provider NOT IN ('R2','S3','MINIO','LOCAL') THEN
    RAISE EXCEPTION 'Invalid storage provider' USING ERRCODE='22023';
  END IF;
  SELECT r.state,r.signed INTO v_state,v_signed FROM app_pmoc_signature_link_sign(
    p_token_hash,p_signer_name,p_signer_document,p_signer_email,p_ip,p_user_agent,
    p_bucket,p_object_key,p_mime_type,p_size_bytes,p_sha256) r;
  IF v_signed THEN
    UPDATE storage_files f SET provider=p_provider,
      file_name=CASE WHEN p_mime_type='image/webp' THEN 'assinatura-contratante.webp' ELSE f.file_name END
    FROM pmoc_plan_signature_links l
    WHERE l.token_hash=p_token_hash AND f.id=l.signature_file_id;
  END IF;
  RETURN QUERY SELECT v_state,v_signed;
END $$;
REVOKE ALL ON FUNCTION app_pmoc_signature_link_sign_storage(text,text,text,text,text,text,text,text,text,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pmoc_signature_link_sign_storage(text,text,text,text,text,text,text,text,text,bigint,text,text) TO orbit_app;
