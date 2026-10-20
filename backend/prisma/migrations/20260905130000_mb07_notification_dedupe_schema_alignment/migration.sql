-- Prisma não representa predicate de índice parcial. UNIQUE comum preserva
-- múltiplos NULL no PostgreSQL e expõe o compound key ao client gerado.
DROP INDEX "notifications_org_dedupe_key";
CREATE UNIQUE INDEX "notifications_org_dedupe_key"
  ON "notifications"("organization_id", "dedupe_key");
