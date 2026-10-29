import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsOptional,
} from 'class-validator';
import { IsUUIDv7 } from '../../../validators';
export class CheckOperationScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(21)
  @ArrayUnique()
  @IsUUIDv7({ each: true })
  userIds!: string[];
  @Type(() => Date) @IsDate() scheduledStart!: Date;
  @IsOptional() @Type(() => Date) @IsDate() scheduledEnd?: Date;
  @IsOptional() @IsUUIDv7() excludeOperationId?: string;
  @IsOptional() @IsUUIDv7() excludeEventId?: string;
}
