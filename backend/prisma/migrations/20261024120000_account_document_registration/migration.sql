BEGIN;
SELECT set_config('app.is_platform_admin', 'true', true);
LOCK TABLE business_units IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE account_document_registrations (
  document_number VARCHAR(14) PRIMARY KEY,
  organization_id UUID NOT NULL,
  registered_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT account_document_registrations_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT account_document_registrations_normalized_document
    CHECK (document_number ~ '^[0-9]{11}([0-9]{3})?$')
);
CREATE INDEX account_document_registrations_org_idx ON account_document_registrations(organization_id);
ALTER TABLE account_document_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_document_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY account_document_registration_platform ON account_document_registrations
  USING (current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_platform_admin', true) = 'true');

-- Repetições históricas são reservadas uma vez, sem excluir ou alterar contas.
INSERT INTO account_document_registrations(document_number, organization_id, registered_at)
SELECT DISTINCT ON (document) document, organization_id, created_at
FROM (
  SELECT regexp_replace(document_number, '[^0-9]', '', 'g') AS document,
         organization_id, created_at, id
  FROM business_units WHERE document_type IN ('CPF', 'CNPJ')
) existing
WHERE document ~ '^[0-9]{11}([0-9]{3})?$'
ORDER BY document, created_at, id;

-- A PK serializa dois cadastros simultâneos. O FK adiado permite reservar antes
-- de criar a conta; qualquer falha posterior desfaz a reserva no mesmo rollback.
CREATE FUNCTION app_reserve_registration_document(p_document text, p_organization uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET app.is_platform_admin = 'true' AS $$
DECLARE inserted bigint;
BEGIN
  IF p_document IS NULL OR p_document !~ '^[0-9]{11}([0-9]{3})?$' THEN
    RAISE EXCEPTION 'INVALID_REGISTRATION_DOCUMENT' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.account_document_registrations(document_number, organization_id)
  VALUES (p_document, p_organization) ON CONFLICT (document_number) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted = 1;
END $$;
REVOKE ALL ON FUNCTION app_reserve_registration_document(text, uuid) FROM PUBLIC;

-- Organizações internas podem repetir o documento. Novos documentos usados por
-- elas também ficam conhecidos, evitando outro cadastro público independente.
CREATE FUNCTION app_remember_account_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET app.is_platform_admin = 'true' AS $$
DECLARE normalized text;
BEGIN
  normalized := regexp_replace(NEW.document_number, '[^0-9]', '', 'g');
  IF NEW.document_type IN ('CPF', 'CNPJ') AND normalized ~ '^[0-9]{11}([0-9]{3})?$' THEN
    INSERT INTO public.account_document_registrations(document_number, organization_id)
    VALUES (normalized, NEW.organization_id) ON CONFLICT (document_number) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_remember_account_document() FROM PUBLIC;
CREATE TRIGGER business_units_remember_account_document
AFTER INSERT OR UPDATE OF document_number, document_type ON business_units
FOR EACH ROW EXECUTE FUNCTION app_remember_account_document();

ALTER TABLE business_units DROP CONSTRAINT IF EXISTS "business_units_organization_id_document_type_document_numbe_key";
DROP INDEX IF EXISTS "business_units_organization_id_document_type_document_numbe_key";
CREATE INDEX business_units_org_document_idx ON business_units(organization_id, document_type, document_number);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbit_app') THEN
    GRANT EXECUTE ON FUNCTION app_reserve_registration_document(text, uuid) TO orbit_app;
    GRANT SELECT ON account_document_registrations TO orbit_app;
    REVOKE INSERT, UPDATE, DELETE ON account_document_registrations FROM orbit_app;
  END IF;
END $$;
COMMIT;
