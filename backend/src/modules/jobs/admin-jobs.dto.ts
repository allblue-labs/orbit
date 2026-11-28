import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { JOB_QUEUES } from './background-job.types';

export class JobFailureQuery {
  @IsOptional() @IsIn(Object.values(JOB_QUEUES)) queue?: string;
  @IsOptional() @IsIn(['pdf', 'comms', 'core', 'fiscal', 'ai']) group?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @Matches(/^[A-Z0-9_.:-]{1,160}$/) code?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() through?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsUUID() after?: string;
}

export class RequeueInput {
  @IsInt() @Min(0) @Max(2_147_483_646) generation!: number;
}

export class RequeueJob extends RequeueInput {
  @IsUUID() id!: string;
}

export class RequeueBatch {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => RequeueJob)
  items!: RequeueJob[];
}

export class EmailFailureQuery {
  @IsIn(['identity', 'contact']) source!: 'identity' | 'contact';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsUUID() after?: string;
}
