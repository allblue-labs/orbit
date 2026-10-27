import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ProductKind, ProductStatus } from '../../contracts';
import { IsUUIDv7 } from '../../validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CatalogQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  search?: string;

  @ApiPropertyOptional({ enum: Object.values(ProductKind) })
  @IsOptional()
  @IsIn(Object.values(ProductKind))
  kind?: ProductKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  /**
   * Filtra por disponibilidade.
   *
   * Ausente devolve ativos e inativos — o comportamento anterior, preservado.
   */
  @ApiPropertyOptional({ enum: Object.values(ProductStatus) })
  @IsOptional()
  @IsIn(Object.values(ProductStatus))
  status?: ProductStatus;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CreateProductCategoryDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  parentId?: string;
}

export class UpdateProductCategoryDto extends PartialType(
  CreateProductCategoryDto,
) {}

export class CreateProductDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;

  @ApiProperty({ enum: Object.values(ProductKind) })
  @IsIn(Object.values(ProductKind))
  kind!: ProductKind;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  sku?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 'UN' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salePrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  costPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  taxData?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Quantidade da entrada inicial no estoque.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9_999_999)
  initialStock?: number;

  @ApiPropertyOptional({
    description: 'Unidade onde a entrada inicial será registrada.',
  })
  @IsOptional()
  @IsUUIDv7()
  initialStockBusinessUnitId?: string;
}

export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, [
    'initialStock',
    'initialStockBusinessUnitId',
  ] as const),
) {
  /**
   * Ativa ou desativa o item sem removê-lo.
   *
   * Um item inativo continua existindo, continua listável e continua
   * referenciado por registros anteriores — apenas deixa de ser oferecido
   * (`findAvailableProduct` já exigia `status: 'ACTIVE'`). É a diferença
   * entre "não vendemos mais isto" e "isto nunca existiu".
   */
  @ApiPropertyOptional({ enum: Object.values(ProductStatus) })
  @IsOptional()
  @IsIn(Object.values(ProductStatus))
  status?: ProductStatus;

  @ApiPropertyOptional({
    description:
      'Remove business-unit scope and make the product organization-wide.',
  })
  @IsOptional()
  @IsBoolean()
  organizationWide?: boolean;

  @ApiPropertyOptional({ description: 'Remove the current category.' })
  @IsOptional()
  @IsBoolean()
  uncategorized?: boolean;
}
