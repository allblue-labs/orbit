import type { Prisma, RvtConfiguration } from '@prisma/client';
import type {
  CreateAdHocRvtDto,
  CreateRvtConfigurationDto,
  RvtConfigurationQueryDto,
  RvtOccurrenceQueryDto,
  UpdateRvtOccurrenceDto,
} from './rvt.dto';
import type { RvtPartyReadModel } from './rvt.read-models';

export type CreateRvtConfigurationCommand = CreateRvtConfigurationDto & {
  organizationId: string;
};

export type CreateAdHocRvtCommand = CreateAdHocRvtDto & {
  organizationId: string;
  actorId: string;
  coverageStart: string;
  scheduledFor: Date;
};

export type ManageRvtOccurrenceCommand = UpdateRvtOccurrenceDto & {
  scheduledFor?: Date;
};

export type ScopedRvtQuery<
  T extends RvtConfigurationQueryDto | RvtOccurrenceQueryDto,
> = T & {
  businessUnitIds: readonly string[];
};

export const equipmentSnapshotSelect = {
  id: true,
  name: true,
  category: true,
  identifier: true,
  serialNumber: true,
  manufacturer: true,
  model: true,
  location: true,
} satisfies Prisma.AssetSelect;

export const maintenanceTypeView = {
  checklistTemplate: {
    select: { id: true, key: true, name: true, version: true, items: true },
  },
} satisfies Prisma.RvtMaintenanceTypeInclude;

type MaintenanceType = Prisma.RvtMaintenanceTypeGetPayload<{
  include: typeof maintenanceTypeView;
}>;

export type RvtMaintenanceTypeSource = Pick<
  MaintenanceType,
  'id' | 'key' | 'label' | 'intervalDays' | 'intervalMonths'
> & {
  checklistTemplate: Pick<
    NonNullable<MaintenanceType['checklistTemplate']>,
    'id' | 'name' | 'version'
  > | null;
};

export type RvtOccurrenceSource = Prisma.RvtOccurrenceGetPayload<{
  include: { execution: { select: { id: true } } };
}>;

export type RvtConfigurationSource = Pick<
  RvtConfiguration,
  | 'id'
  | 'code'
  | 'name'
  | 'scheduleMode'
  | 'status'
  | 'calendarId'
  | 'startTime'
  | 'coverageStart'
  | 'coverageEnd'
  | 'timezone'
  | 'serviceLocation'
  | 'recurrence'
  | 'procedure'
  | 'businessUnitId'
  | 'customerId'
  | 'requiresTechnicalResponsible'
  | 'createdAt'
  | 'updatedAt'
> & {
  businessUnitName: string;
  customerName: string;
  technicalResponsible: RvtPartyReadModel | null;
  fieldTechnician: RvtPartyReadModel | null;
  maintenanceType: RvtMaintenanceTypeSource | null;
  equipment: Prisma.AssetGetPayload<{
    select: typeof equipmentSnapshotSelect;
  }>[];
  occurrences: RvtOccurrenceSource[];
};

export const executionView = {
  equipment: true,
  evidence: true,
  occurrence: { include: { configuration: true } },
} satisfies Prisma.RvtExecutionInclude;

export type RvtExecutionSource = Prisma.RvtExecutionGetPayload<{
  include: typeof executionView;
}> & {
  assignmentAuthorizationRequired: boolean;
  fieldTechnicianName: string;
  technicalResponsibleName: string;
  auxiliaryTechnicians: RvtPartyReadModel[];
  operation: { id: string; code: string; status: string } | null;
  artifact: {
    id: string;
    code: string;
    status: string;
    renderStatus: string;
  } | null;
};
