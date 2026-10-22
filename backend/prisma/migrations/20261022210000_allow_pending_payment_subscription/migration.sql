-- Paid registrations start pending payment; access is granted after confirmation.
-- Keep the existing statuses and validate all rows with the updated constraint.
ALTER TABLE "organization_subscriptions"
  DROP CONSTRAINT "organization_subscriptions_status_valid",
  ADD CONSTRAINT "organization_subscriptions_status_valid" CHECK (
    "status" IN (
      'PENDING_PAYMENT', 'TRIALING', 'ACTIVE', 'PAST_DUE',
      'GRACE_PERIOD', 'SUSPENDED', 'CANCELED', 'EXPIRED'
    )
  );
