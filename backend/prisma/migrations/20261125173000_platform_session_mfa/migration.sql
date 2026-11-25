-- Existing sessions cannot prove a second factor was verified at login.
ALTER TABLE public.sessions ADD COLUMN platform_mfa_factor_id uuid;
