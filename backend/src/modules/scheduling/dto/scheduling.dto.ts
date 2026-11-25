import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsUUIDv7 } from '../../../validators';

export const SchedulingEventStatus = {
  TENTATIVE: 'TENTATIVE',
  CONFIRMED: 'CONFIRMED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export const RecurrenceFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  CUSTOM: 'CUSTOM',
} as const;
export const ResourceType = {
  USER: 'USER',
  ASSET: 'ASSET',
  CUSTOM: 'CUSTOM',
} as const;
export const AvailabilityKind = {
  AVAILABLE: 'AVAILABLE',
  BLOCKED: 'BLOCKED',
} as const;
export const AgendaView = {
  DAY: 'DAY',
  WEEK: 'WEEK',
  MONTH: 'MONTH',
} as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCalendarDto {
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/)
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;

  @IsTimeZone()
  timezone!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCalendarDto extends PartialType(CreateCalendarDto) {}

export class RecurrenceDto {
  @IsIn(Object.values(RecurrenceFrequency))
  frequency!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  interval?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  byWeekday?: number[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  byMonthDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  count?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  until?: Date;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => Date)
  @IsDate({ each: true })
  customDates?: Date[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => Date)
  @IsDate({ each: true })
  exceptions?: Date[];

  @IsTimeZone()
  timezone!: string;
}

export class ResourceAllocationDto {
  @IsIn(Object.values(ResourceType))
  resourceType!: string;

  @IsOptional()
  @IsUUIDv7()
  userId?: string;

  @IsOptional()
  @IsUUIDv7()
  assetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  resourceKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  role?: string;
}

export class CreateEventDto {
  @IsUUIDv7()
  calendarId!: string;

  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @IsOptional()
  @IsUUIDv7()
  assetId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(220)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  type!: string;

  @IsOptional()
  @IsIn(Object.values(SchedulingEventStatus))
  status?: string;

  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'CRITICAL'])
  priority?: string;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsTimeZone()
  timezone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  segment?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sourceModule!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sourceEntityType!: string;

  @IsOptional()
  @IsUUIDv7()
  sourceEntityId?: string;

  @IsOptional()
  @IsObject()
  location?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ResourceAllocationDto)
  allocations?: ResourceAllocationDto[];

  @IsOptional()
  @IsBoolean()
  allowConflicts?: boolean;
}

export class UpdateEventDto extends PartialType(CreateEventDto) {
  @IsOptional()
  @IsBoolean()
  clearRecurrence?: boolean;
}

export class CalendarQueryDto {
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;
}

export class EventQueryDto {
  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  from!: Date;

  @ApiProperty()
  @Type(() => Date)
  @IsDate()
  to!: Date;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  remindersOnly?: 'true' | 'false';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  calendarId?: string;

  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsOptional()
  @IsUUIDv7()
  userId?: string;

  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @IsOptional()
  @IsUUIDv7()
  assetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  segment?: string;

  @IsOptional()
  @IsIn(Object.values(SchedulingEventStatus))
  status?: string;
}

export class AgendaQueryDto {
  @IsIn(Object.values(AgendaView))
  view!: string;

  @Type(() => Date)
  @IsDate()
  date!: Date;

  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsOptional()
  @IsUUIDv7()
  userId?: string;

  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @IsOptional()
  @IsUUIDv7()
  assetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  segment?: string;
}

export class CreateAvailabilityDto {
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsOptional()
  @IsUUIDv7()
  userId?: string;

  @IsIn(Object.values(ResourceType))
  resourceType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  resourceKey?: string;

  @IsIn(Object.values(AvailabilityKind))
  kind!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  date?: Date;

  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute!: number;

  @IsTimeZone()
  timezone!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveUntil?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AvailabilityQueryDto {
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsOptional()
  @IsUUIDv7()
  userId?: string;

  @IsOptional()
  @IsIn(Object.values(ResourceType))
  resourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  resourceKey?: string;
}

export class AddAllocationDto {
  @ValidateNested()
  @Type(() => ResourceAllocationDto)
  allocation!: ResourceAllocationDto;

  @IsOptional()
  @IsBoolean()
  allowConflicts?: boolean;
}
