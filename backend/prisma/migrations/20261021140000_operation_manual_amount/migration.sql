ALTER TABLE "operations" ADD COLUMN "manual_amount" DECIMAL(14, 2);
ALTER TABLE "operations" ADD CONSTRAINT "operations_manual_amount_nonnegative"
  CHECK ("manual_amount" IS NULL OR "manual_amount" >= 0);
