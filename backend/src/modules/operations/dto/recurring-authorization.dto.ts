import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsUUIDv7 } from '../../../validators';

export class RecurringAuthorizationQueryDto {
  @IsOptional() @IsUUIDv7() businessUnitId?: string;
  @IsOptional() @IsUUIDv7() assignedUserId?: string;
  @IsOptional() @IsString() @MaxLength(180) search?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) page = 1;
}
export class RecurringAuthorizationTargetDto {
  @IsIn(['RVT', 'PMOC']) kind!: 'RVT' | 'PMOC';
  @IsUUIDv7() id!: string;
  @IsISO8601() version!: string;
}
export class AuthorizeRecurringAssignmentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique(
    (item: RecurringAuthorizationTargetDto) => `${item.kind}:${item.id}`,
  )
  @ValidateNested({ each: true })
  @Type(() => RecurringAuthorizationTargetDto)
  items!: RecurringAuthorizationTargetDto[];
}
