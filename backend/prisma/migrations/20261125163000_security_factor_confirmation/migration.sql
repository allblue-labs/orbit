ALTER TABLE public.auth_challenges
  DROP CONSTRAINT auth_challenges_purpose_check,
  ADD CONSTRAINT auth_challenges_purpose_check CHECK (purpose IN (
    'USER_REGISTER', 'USER_LOGIN', 'PORTAL_REGISTER', 'PORTAL_LOGIN',
    'USER_SECURITY_CONFIRMATION', 'PORTAL_SECURITY_CONFIRMATION'
  ));
