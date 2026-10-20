-- PR-32 closure: PostgreSQL/Prisma integration corrections discovered only
-- after the original migration was exercised through the restricted runtime.
-- The original migration is already applied and intentionally remains intact.

CREATE OR REPLACE FUNCTION app_customer_portal_activate_invitation(
  p_token_hash text, p_password_hash text
) RETURNS TABLE(
  "id" uuid, "organizationId" uuid, "customerId" uuid, "contactId" uuid,
  "email" text, "normalizedEmail" text, "displayName" text, "passwordHash" text,
  "status" text, "failedAttempts" integer, "lockedUntil" timestamptz,
  "emailVerifiedAt" timestamptz, "lastLoginAt" timestamptz, "disabledAt" timestamptz,
  "organizationSlug" text, "organizationName" text, "organizationStatus" text,
  "organizationDeletedAt" timestamptz, "customerName" text, "customerStatus" text,
  "customerDeletedAt" timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_inv customer_portal_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM customer_portal_invitations
   WHERE token_hash = p_token_hash AND accepted_at IS NULL AND revoked_at IS NULL
     AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE customer_portal_identities SET password_hash = p_password_hash, status = 'ACTIVE',
    email_verified_at = clock_timestamp(), password_updated_at = clock_timestamp(),
    failed_attempts = 0, locked_until = NULL, disabled_at = NULL, updated_at = clock_timestamp()
   WHERE customer_portal_identities.id = v_inv.portal_identity_id
     AND customer_portal_identities.status = 'INVITED';
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE customer_portal_invitations SET accepted_at = clock_timestamp()
   WHERE customer_portal_invitations.id = v_inv.id;
  INSERT INTO audit_logs (id, organization_id, action, entity_type, entity_id, metadata)
  VALUES (gen_random_uuid(), v_inv.organization_id,
    'customer.portal.identity.activated', 'CUSTOMER_PORTAL_IDENTITY', v_inv.portal_identity_id,
    jsonb_build_object('actorType', 'CUSTOMER_PORTAL'));
  RETURN QUERY SELECT * FROM app_customer_portal_find_login(
    (SELECT slug::text FROM organizations WHERE organizations.id = v_inv.organization_id),
    (SELECT normalized_email::text FROM customer_portal_identities
      WHERE customer_portal_identities.id = v_inv.portal_identity_id));
END;
$$;

REVOKE ALL ON FUNCTION app_customer_portal_activate_invitation(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_customer_portal_activate_invitation(text,text) TO orbit_app;
