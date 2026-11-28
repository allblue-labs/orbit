import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const ticketPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const administrativeCategories = [
  'ACCOUNT_ACCESS',
  'TECHNICAL',
  'GENERAL',
] as const;
export const ticketCategories = [
  ...administrativeCategories,
  'PLAN_CHANGE',
  'CANCELLATION',
  'REFUND_REVIEW',
] as const;
export const ticketStates = ['OPEN', 'RESOLVED'] as const;
export const operationTypes = [
  'TENANT_PROVISIONING',
  'STRIPE_WEBHOOK',
  'STRIPE_RECOVERY',
  'IDENTITY_EMAIL',
  'CONTACT_EMAIL',
] as const;
export const operationStates = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'IGNORED',
  'RETRYABLE_FAILURE',
  'TERMINAL_FAILURE',
  'UNCONFIRMED',
] as const;
export const resumeReasons = [
  'DEPENDENCY_RESTORED',
  'WORKFLOW_INTERRUPTED',
  'RETRY_AFTER_REVIEW',
] as const;

export type Priority = (typeof ticketPriorities)[number];
export type TicketStatus = (typeof ticketStates)[number];

export class SupportPageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export const ticketSorts = [
  'CREATED_DESC',
  'CREATED_ASC',
  'UPDATED_DESC',
  'UPDATED_ASC',
  'PRIORITY_DESC',
] as const;
export type TicketSort = (typeof ticketSorts)[number];

export class SupportTicketsQuery extends SupportPageDto {
  @IsOptional()
  @IsIn(ticketSorts)
  sort?: TicketSort;

  @IsOptional()
  @IsIn(['true'])
  includeDetails?: 'true';

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsIn(['ADMINISTRATIVE', 'BILLING'])
  origin?: 'ADMINISTRATIVE' | 'BILLING';

  @IsOptional()
  @IsIn(ticketCategories)
  category?: (typeof ticketCategories)[number];

  @IsOptional()
  @IsIn(ticketPriorities)
  priority?: Priority;

  @IsOptional()
  @IsIn(ticketStates)
  status?: TicketStatus;

  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  search?: string;
}

export class TicketInteractionsQuery {
  @IsOptional()
  @IsIn(['true'])
  includeDetails?: 'true';

  @IsOptional()
  @IsUUID()
  before?: string;
}

export class CreateSupportTicketDto {
  @IsUUID()
  organizationId!: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(160)
  title!: string;

  @IsIn(administrativeCategories)
  category!: (typeof administrativeCategories)[number];

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(ticketPriorities)
  priority?: Priority;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  initialNote?: string;
}

export class UpdateSupportTicketDto {
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(ticketPriorities)
  priority?: Priority;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(['RESOLVED'])
  status?: 'RESOLVED';

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  resolution?: string;
}

export class SupportNoteDto {
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;

  @IsString()
  @Matches(/\S/)
  @MaxLength(2000)
  body!: string;
}

export class DiagnosticOperationsQuery extends SupportPageDto {
  @IsOptional()
  @IsIn(['true'])
  includeDetails?: 'true';

  @IsOptional()
  @IsIn(operationTypes)
  type?: (typeof operationTypes)[number];

  @IsOptional()
  @IsIn(operationStates)
  status?: (typeof operationStates)[number];

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsIn(['TEST', 'LIVE'])
  mode?: 'TEST' | 'LIVE';
}

export class ResumeSupportProvisioningDto {
  @IsInt()
  @Min(1)
  @Max(2147483646)
  expectedVersion!: number;

  @IsIn(resumeReasons)
  reason!: (typeof resumeReasons)[number];
}
