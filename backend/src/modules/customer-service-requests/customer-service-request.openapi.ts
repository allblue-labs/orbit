import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CUSTOMER_SERVICE_REQUEST_CATEGORIES,
  CUSTOMER_SERVICE_REQUEST_STATUSES,
} from './customer-service-request.types';

export class CustomerServiceRequestLabelSchema {
  @ApiProperty({ example: 'OPEN' })
  code!: string;

  @ApiProperty({ example: 'Aberto' })
  label!: string;
}

export class CustomerServiceRequestAssetSchema {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  identifier!: string | null;
}

export class CustomerServiceRequestTimelineSchema {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty({ enum: ['PORTAL', 'INTERNAL'] })
  visibility!: string;

  @ApiProperty({ example: { type: 'CUSTOMER_PORTAL', displayName: 'Cliente' } })
  actor!: { type: string; displayName: string };

  @ApiPropertyOptional({ nullable: true })
  message!: string | null;

  @ApiPropertyOptional({ nullable: true })
  statusChange!: { from: string | null; to: string | null } | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class CustomerServiceRequestListItemSchema {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'CH-2026-A1B2C3D4E5' })
  code!: string;

  @ApiProperty({
    type: CustomerServiceRequestLabelSchema,
    description: `code: ${CUSTOMER_SERVICE_REQUEST_CATEGORIES.join(' | ')}`,
  })
  category!: CustomerServiceRequestLabelSchema;

  @ApiProperty()
  subject!: string;

  @ApiProperty({
    type: CustomerServiceRequestLabelSchema,
    description: `code: ${CUSTOMER_SERVICE_REQUEST_STATUSES.join(' | ')}`,
  })
  status!: CustomerServiceRequestLabelSchema;

  @ApiPropertyOptional({
    type: CustomerServiceRequestAssetSchema,
    nullable: true,
  })
  asset!: CustomerServiceRequestAssetSchema | null;

  @ApiProperty({ format: 'date-time' })
  submittedAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiProperty({ minimum: 1 })
  version!: number;

  @ApiProperty({ type: [String] })
  allowedActions!: string[];
}

export class CustomerServiceRequestDetailsSchema extends CustomerServiceRequestListItemSchema {
  @ApiProperty()
  description!: string;

  @ApiProperty({
    example: { id: '01900000-0000-7000-8000-000000000001', name: 'Cliente' },
  })
  customer!: { id: string; name: string };

  @ApiPropertyOptional({ nullable: true })
  businessUnit!: { id: string; name: string } | null;

  @ApiPropertyOptional({ nullable: true })
  assignedTo!: { id: string; displayName: string } | null;

  @ApiPropertyOptional({ nullable: true })
  convertedOperation!: { id: string; code: string; status: string } | null;

  @ApiProperty({ type: [CustomerServiceRequestTimelineSchema] })
  timeline!: CustomerServiceRequestTimelineSchema[];

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  closedAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  cancelledAt!: string | null;
}

export class CustomerServiceRequestPageMetaSchema {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class CustomerServiceRequestPageSchema {
  @ApiProperty({ type: [CustomerServiceRequestListItemSchema] })
  data!: CustomerServiceRequestListItemSchema[];

  @ApiProperty({ type: CustomerServiceRequestPageMetaSchema })
  meta!: CustomerServiceRequestPageMetaSchema;
}
