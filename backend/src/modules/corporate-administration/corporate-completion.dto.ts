import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { SupportPageDto } from './corporate-support.dto';

export const receiptTypes = [
  'PROVISIONING',
  'OPERATIONAL',
  'COMMERCIAL',
  'PROMOTION',
  'SUPPORT',
] as const;
export type ReceiptType = (typeof receiptTypes)[number];
export const commandTypes = [
  'CHANGE_PLAN',
  'KEEP',
  'CANCEL_SCHEDULED_CHANGE',
  'START_TRIAL',
  'CREATE',
  'UPDATE',
  'ACTIVATE',
  'DEACTIVATE',
] as const;
export const billingModes = ['TEST', 'LIVE'] as const;

export class ExpandAdministrativeDetailDto {
  @IsOptional()
  @IsIn(['true'])
  includeDetails?: 'true';
}

export class ProvisioningListDto extends SupportPageDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsIn(['RECEIVED', 'TENANT_CREATED', 'SUBSCRIPTION_READY', 'COMPLETED'])
  status?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/)
  createdFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/)
  createdBefore?: string;
}

export class ReceiptHistoryDto extends SupportPageDto {
  @IsOptional()
  @IsIn(receiptTypes.filter((type) => type !== 'PROMOTION'))
  type?: ReceiptType;
}

export class ReceiptLookupDto {
  @IsIn(receiptTypes)
  type!: ReceiptType;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  operationId?: string;

  @IsOptional()
  @IsIn(commandTypes)
  operation?: (typeof commandTypes)[number];
}

export class SubscriptionListDto extends SupportPageDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{1,60}$/)
  planCode?: string;

  @IsOptional()
  @IsIn(['MONTHLY', 'SEMIANNUAL', 'ANNUAL'])
  billingInterval?: string;

  @IsOptional()
  @IsIn([
    'PENDING_PAYMENT',
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'GRACE_PERIOD',
    'SUSPENDED',
    'EXPIRED',
    'CANCELED',
  ])
  persistedStatus?: string;
}
