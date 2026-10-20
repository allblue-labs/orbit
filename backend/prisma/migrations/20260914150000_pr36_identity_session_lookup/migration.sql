-- Supports the bounded, latest-first security session overview.
CREATE INDEX sessions_user_created_at_idx
ON sessions (user_id, created_at DESC);
