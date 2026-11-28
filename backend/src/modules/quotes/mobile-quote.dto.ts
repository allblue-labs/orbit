import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AddQuoteItemDto, CreateQuoteDto } from './quote.dto';

import { IsUUIDv7 } from '../../validators';

export class MobileQuoteQueryDto {
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  search?: string;
}

/** Native counterpart of the web wizard; totals and transitions stay in QuoteService. */
export class CreateMobileQuoteDto extends CreateQuoteDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,160}$/)
  requestId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AddQuoteItemDto)
  items!: AddQuoteItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  discount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  discountReason?: string;
}
