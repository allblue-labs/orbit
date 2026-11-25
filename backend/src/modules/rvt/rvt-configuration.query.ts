import type { PrismaTransactionClient } from '../../database/prisma.types';
import {
  equipmentSnapshotSelect,
  type RvtConfigurationSource,
} from './rvt.persistence';

type ConfigurationHeader = Omit<
  RvtConfigurationSource,
  | 'equipment'
  | 'occurrences'
  | 'maintenanceType'
  | 'technicalResponsible'
  | 'fieldTechnician'
> & {
  maintenanceTypeId: string | null;
  maintenanceTypeKey: string | null;
  maintenanceTypeLabel: string | null;
  intervalDays: number | null;
  intervalMonths: number | null;
  checklistId: string | null;
  checklistName: string | null;
  checklistVersion: number | null;
  technicalResponsibleId: string | null;
  technicalResponsibleName: string | null;
  fieldTechnicianId: string | null;
  fieldTechnicianName: string | null;
};

/** Hydrates details in one transaction for a single contract or a page of IDs. */
export async function readRvtConfigurations(
  tx: PrismaTransactionClient,
  organizationId: string,
  ids: string[],
): Promise<RvtConfigurationSource[]> {
  if (!ids.length) return [];
  // Some legacy relations are SQL-only in this schema. Select the declared
  // projection explicitly, keeping deleted checklist and historical types
  // semantics independent from the catalog listing.
  const headers = await tx.$queryRaw<ConfigurationHeader[]>`
    SELECT c.id, c.code, c.name, c.status, c.timezone, c.recurrence, c.procedure,
      c.schedule_mode AS "scheduleMode", c.calendar_id AS "calendarId",
      c.start_time AS "startTime", c.coverage_start AS "coverageStart",
      c.coverage_end AS "coverageEnd", c.service_location AS "serviceLocation",
      c.business_unit_id AS "businessUnitId", c.customer_id AS "customerId",
      c.requires_technical_responsible AS "requiresTechnicalResponsible",
      c.created_at AS "createdAt", c.updated_at AS "updatedAt",
      COALESCE(b.trade_name, b.legal_name) AS "businessUnitName",
      COALESCE(cu.trade_name, cu.legal_name) AS "customerName",
      c.technical_responsible_user_id AS "technicalResponsibleId",
      tr.display_name AS "technicalResponsibleName",
      c.default_responsible_field_technician_id AS "fieldTechnicianId",
      ft.display_name AS "fieldTechnicianName",
      mt.id AS "maintenanceTypeId", mt.key AS "maintenanceTypeKey",
      mt.label AS "maintenanceTypeLabel", mt.interval_days AS "intervalDays",
      mt.interval_months AS "intervalMonths", ct.id AS "checklistId",
      ct.name AS "checklistName", ct.version AS "checklistVersion"
    FROM rvt_configurations c
    JOIN business_units b ON b.id = c.business_unit_id
    JOIN customers cu ON cu.id = c.customer_id
    LEFT JOIN users tr ON tr.id = c.technical_responsible_user_id
    LEFT JOIN users ft ON ft.id = c.default_responsible_field_technician_id
    LEFT JOIN rvt_maintenance_types mt ON mt.id = c.maintenance_type_id
    LEFT JOIN checklist_templates ct ON ct.id = mt.checklist_template_id AND ct.deleted_at IS NULL
    WHERE c.id = ANY(${ids}::uuid[]) AND c.organization_id = ${organizationId}::uuid
      AND c.deleted_at IS NULL
  `;
  const configurationIds = headers.map(({ id }) => id);
  if (!configurationIds.length) return [];
  const links = await tx.rvtConfigurationEquipment.findMany({
    where: { configurationId: { in: configurationIds }, removedAt: null },
    select: { configurationId: true, assetId: true },
  });
  const assets = await tx.asset.findMany({
    where: {
      id: { in: [...new Set(links.map(({ assetId }) => assetId))] },
      organizationId,
    },
    select: equipmentSnapshotSelect,
  });
  const occurrences = await tx.rvtOccurrence.findMany({
    where: { configurationId: { in: configurationIds }, deletedAt: null },
    include: { execution: { select: { id: true } } },
    orderBy: { sequenceNumber: 'asc' },
  });

  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const byId = new Map<string, RvtConfigurationSource>();
  for (const row of headers) {
    const party = (id: string | null, name: string | null) =>
      id ? { id, name: name ?? '' } : null;
    byId.set(row.id, {
      ...row,
      technicalResponsible: party(
        row.technicalResponsibleId,
        row.technicalResponsibleName,
      ),
      fieldTechnician: party(row.fieldTechnicianId, row.fieldTechnicianName),
      maintenanceType:
        row.maintenanceTypeId &&
        row.maintenanceTypeKey !== null &&
        row.maintenanceTypeLabel !== null
          ? {
              id: row.maintenanceTypeId,
              key: row.maintenanceTypeKey,
              label: row.maintenanceTypeLabel,
              intervalDays: row.intervalDays,
              intervalMonths: row.intervalMonths,
              checklistTemplate:
                row.checklistId &&
                row.checklistName !== null &&
                row.checklistVersion !== null
                  ? {
                      id: row.checklistId,
                      name: row.checklistName,
                      version: row.checklistVersion,
                    }
                  : null,
            }
          : null,
      equipment: [],
      occurrences: [],
    });
  }
  for (const link of links) {
    const asset = assetsById.get(link.assetId);
    if (asset) byId.get(link.configurationId)?.equipment.push(asset);
  }
  for (const occurrence of occurrences)
    byId.get(occurrence.configurationId)?.occurrences.push(occurrence);
  return ids.flatMap((id) => {
    const configuration = byId.get(id);
    return configuration ? [configuration] : [];
  });
}
