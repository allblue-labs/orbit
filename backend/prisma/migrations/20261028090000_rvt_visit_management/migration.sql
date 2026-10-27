ALTER TABLE "rvt_configurations"
  ADD COLUMN "calendar_id" UUID,
  ADD COLUMN "start_time" VARCHAR(5) NOT NULL DEFAULT '09:00';

ALTER TABLE "rvt_occurrences"
  ADD COLUMN "responsible_field_technician_id" UUID,
  ADD COLUMN "equipment_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "original_scheduled_date" DATE,
  ADD COLUMN "customized" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

-- Preserve the planned equipment and technician on existing visits.
UPDATE "rvt_occurrences" o
SET "original_scheduled_date" = o."local_scheduled_date",
    "responsible_field_technician_id" = c."default_responsible_field_technician_id",
    "equipment_ids" = ARRAY(
      SELECT e."asset_id" FROM "rvt_configuration_equipment" e
      WHERE e."configuration_id" = c."id" AND e."removed_at" IS NULL
    )
FROM "rvt_configurations" c
WHERE c."id" = o."configuration_id";

-- Executed visits retain the actual attendant and their frozen equipment set.
UPDATE "rvt_occurrences" o
SET "responsible_field_technician_id" = e."responsible_field_technician_id",
    "equipment_ids" = ARRAY(
      SELECT a."asset_id" FROM "rvt_execution_equipment" a
      WHERE a."execution_id" = e."id"
    )
FROM "rvt_executions" e
WHERE e."occurrence_id" = o."id" AND e."organization_id" = o."organization_id";
