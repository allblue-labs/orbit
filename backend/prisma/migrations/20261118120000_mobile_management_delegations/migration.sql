ALTER TABLE "organization_memberships"
    ADD COLUMN "mobile_delegations" VARCHAR(40)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(40)[];
