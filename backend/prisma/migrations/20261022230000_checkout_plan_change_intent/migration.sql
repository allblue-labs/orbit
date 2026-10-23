ALTER TABLE "billing_checkout_attempts"
  ADD COLUMN "subscription_version" INTEGER,
  ADD COLUMN "ends_trial" BOOLEAN NOT NULL DEFAULT false;
