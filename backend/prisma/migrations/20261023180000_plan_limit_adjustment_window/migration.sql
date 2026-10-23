ALTER TABLE "organization_subscriptions"
  ADD COLUMN "limits_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "previous_entitlements_snapshot" JSONB;
