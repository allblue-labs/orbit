-- PR-31 — Equipment QR Identity & Field Actions.
-- Identity and rendered image are deliberately separate. Tokens contain 256
-- random bits and no domain identifiers; URLs are composed only at render time.

CREATE TABLE equipment_qr_identities (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  business_unit_id UUID NOT NULL,
  equipment_id UUID NOT NULL,
  token VARCHAR(64) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ(3),
  rotated_at TIMESTAMPTZ(3),
  CONSTRAINT equipment_qr_status_check CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT equipment_qr_lifecycle_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL) OR
    (status = 'REVOKED' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT equipment_qr_organization_fkey FOREIGN KEY (organization_id)
    REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT equipment_qr_business_unit_fkey FOREIGN KEY (business_unit_id)
    REFERENCES business_units(id) ON DELETE RESTRICT,
  CONSTRAINT equipment_qr_equipment_fkey FOREIGN KEY (equipment_id)
    REFERENCES assets(id) ON DELETE RESTRICT,
  CONSTRAINT equipment_qr_token_key UNIQUE (token),
  CONSTRAINT equipment_qr_token_hash_key UNIQUE (token_hash)
);

CREATE UNIQUE INDEX equipment_qr_one_active_per_equipment
  ON equipment_qr_identities(equipment_id)
  WHERE status = 'ACTIVE';
CREATE INDEX equipment_qr_tenant_scope_idx
  ON equipment_qr_identities(organization_id, business_unit_id, status);
CREATE INDEX equipment_qr_equipment_history_idx
  ON equipment_qr_identities(equipment_id, created_at DESC);

ALTER TABLE equipment_qr_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_qr_identities FORCE ROW LEVEL SECURITY;
CREATE POLICY equipment_qr_identities_isolation ON equipment_qr_identities
  FOR ALL
  USING (
    app_is_platform_admin() OR (
      organization_id = app_current_organization_id()
      AND business_unit_id = ANY(app_current_business_unit_ids())
    )
  )
  WITH CHECK (
    app_is_platform_admin() OR (
      organization_id = app_current_organization_id()
      AND business_unit_id = ANY(app_current_business_unit_ids())
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON equipment_qr_identities TO orbit_app;

CREATE OR REPLACE FUNCTION equipment_qr_random_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT translate(rtrim(encode(gen_random_bytes(32), 'base64'), '='), '+/', '-_')
$$;

-- A single domain primitive is shared by the insert trigger, explicit repair
-- commands and imports. The transaction advisory lock makes concurrent ensure
-- calls converge on the same active identity.
CREATE OR REPLACE FUNCTION ensure_equipment_qr_identity(p_equipment_id UUID)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_asset assets%ROWTYPE;
  v_identity_id UUID;
  v_token text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('equipment-qr:' || p_equipment_id::text, 0));

  SELECT * INTO v_asset FROM assets WHERE id = p_equipment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EQUIPMENT_NOT_FOUND';
  END IF;

  SELECT id INTO v_identity_id
  FROM equipment_qr_identities
  WHERE equipment_id = p_equipment_id AND status = 'ACTIVE';
  IF v_identity_id IS NOT NULL THEN
    RETURN v_identity_id;
  END IF;

  v_token := equipment_qr_random_token();
  INSERT INTO equipment_qr_identities (
    id, organization_id, business_unit_id, equipment_id, token, token_hash
  ) VALUES (
    gen_random_uuid(), v_asset.organization_id, v_asset.business_unit_id,
    v_asset.id, v_token, encode(digest(v_token, 'sha256'), 'hex')
  ) RETURNING id INTO v_identity_id;
  RETURN v_identity_id;
END;
$$;

CREATE OR REPLACE FUNCTION equipment_qr_after_asset_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM ensure_equipment_qr_identity(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER assets_ensure_qr_identity
AFTER INSERT ON assets
FOR EACH ROW EXECUTE FUNCTION equipment_qr_after_asset_insert();

-- Production-safe, idempotent set-based backfill. No images are materialized.
DO $$
DECLARE
  v_asset_id UUID;
BEGIN
  FOR v_asset_id IN
    SELECT a.id
    FROM assets a
    WHERE NOT EXISTS (
      SELECT 1 FROM equipment_qr_identities q
      WHERE q.equipment_id = a.id AND q.status = 'ACTIVE'
    )
  LOOP
    PERFORM ensure_equipment_qr_identity(v_asset_id);
  END LOOP;
END;
$$;

UPDATE plans
SET capabilities = ARRAY(
  SELECT DISTINCT capability
  FROM unnest(capabilities || ARRAY['assets.qr.manage']::varchar[]) capability
)
WHERE is_active = true;

UPDATE roles
SET permissions = ARRAY(
  SELECT DISTINCT permission
  FROM unnest(permissions || ARRAY['assets.qr.manage']::varchar[]) permission
)
WHERE name IN ('OWNER', 'ADMIN');

