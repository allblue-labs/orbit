import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';
import type { OfflineCommandType } from './mobile-offline-sync.read-models';

export const OFFLINE_COMMAND_TYPES = [
  'OPERATION_START',
  'OPERATION_CHECKLIST_UPDATE',
  'OPERATION_ADD_NOTE',
  'OPERATION_ADD_MATERIAL',
  'OPERATION_COMPLETE',
  'CUSTOMER_ACKNOWLEDGEMENT',
] as const;

export class OfflineCommandEnvelopeDto {
  @ApiProperty() @IsUUIDv7() commandId!: string;
  @ApiProperty() @IsString() @MaxLength(160) idempotencyKey!: string;
  @ApiProperty({ enum: OFFLINE_COMMAND_TYPES })
  @IsIn(OFFLINE_COMMAND_TYPES)
  commandType!: OfflineCommandType;
  @ApiProperty({ enum: ['OPERATION'] })
  @IsIn(['OPERATION'])
  aggregateType!: 'OPERATION';
  @ApiProperty() @IsUUIDv7() aggregateId!: string;
  @ApiProperty() @IsString() @MaxLength(80) expectedVersion!: string;
  @ApiProperty() @Type(() => Date) @IsDate() occurredAt!: Date;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceInstanceId?: string;
  @ApiProperty() @IsObject() payload!: Record<string, unknown>;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  clientContextVersion?: string;
}

export class MobileSyncPushRequestDto {
  @ApiProperty({ type: [OfflineCommandEnvelopeDto], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OfflineCommandEnvelopeDto)
  commands!: OfflineCommandEnvelopeDto[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  checkpoint?: string;
}

export class MobileSyncPullRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 500 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  knownWorkItemIds?: string[];
}

export class FieldPackageBatchDto {
  @ApiProperty({ type: [String], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  workItemIds!: string[];
}
