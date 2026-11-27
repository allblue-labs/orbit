BEGIN;

-- Fail explicitly if the migration role cannot update the portal's RLS table.
SET LOCAL row_security = off;

ALTER TABLE public.auth_challenges
  DROP CONSTRAINT auth_challenges_purpose_check,
  ADD CONSTRAINT auth_challenges_purpose_check CHECK (purpose IN (
    'USER_REGISTER', 'USER_LOGIN', 'PORTAL_REGISTER', 'PORTAL_LOGIN',
    'USER_SECURITY_CONFIRMATION', 'PORTAL_SECURITY_CONFIRMATION',
    'USER_DEVICE_REGISTER', 'USER_DEVICE_LOGIN',
    'PORTAL_DEVICE_REGISTER', 'PORTAL_DEVICE_LOGIN'
  ));

-- Credential records remain available for historical inspection. A previous
-- app secret must never be accepted again, even during a mixed-version rollout.
DO $$
DECLARE
  credential_table text;
  constraint_name text;
BEGIN
  FOR credential_table, constraint_name IN SELECT * FROM (VALUES
    ('identity_biometric_credentials', 'identity_biometric_kind_check'),
    ('customer_portal_biometric_credentials', 'portal_biometric_kind_check')
  ) AS configuration(table_name, check_name)
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', credential_table, constraint_name);
    EXECUTE format('UPDATE public.%I SET revoked_at = COALESCE(revoked_at, clock_timestamp()), secret_hash = NULL WHERE kind = ''DEVICE''', credential_table);
    EXECUTE format($check$
      ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        secret_hash IS NULL AND (
          (kind = 'DEVICE' AND webauthn_credential_id IS NULL AND
            (revoked_at IS NOT NULL OR (device_id IS NOT NULL AND public_key IS NOT NULL AND octet_length(public_key) = 65)))
          OR (kind = 'WEBAUTHN' AND webauthn_credential_id IS NOT NULL AND public_key IS NOT NULL)
        )
      )
    $check$, credential_table, constraint_name);
  END LOOP;
END;
$$;

COMMIT;
