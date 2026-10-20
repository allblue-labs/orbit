import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PortalStatusSchema {
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
}

class PortalBusinessUnitSchema {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ example: 'America/Recife' }) timezone!: string;
}

class PortalPaginationSchema {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() hasNextPage!: boolean;
  @ApiProperty() hasPreviousPage!: boolean;
}

export class CustomerPortalDashboardSchema {
  @ApiProperty() recentOperations!: number;
  @ApiProperty() assets!: number;
  @ApiProperty() activePmocPlans!: number;
  @ApiProperty() upcomingVisits!: number;
  @ApiProperty() availableDocuments!: number;
}

class CustomerPortalOperationItemSchema {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: PortalStatusSchema }) status!: PortalStatusSchema;
  @ApiPropertyOptional({ nullable: true }) scheduledStart!: string | null;
  @ApiPropertyOptional({ nullable: true }) scheduledEnd!: string | null;
  @ApiPropertyOptional({ nullable: true }) completedAt!: string | null;
  @ApiProperty({ type: PortalBusinessUnitSchema })
  businessUnit!: PortalBusinessUnitSchema;
  @ApiPropertyOptional({ nullable: true }) asset!: object | null;
  @ApiPropertyOptional({ nullable: true }) responsibleTechnician!:
    object | null;
  @ApiPropertyOptional({ nullable: true }) location!: string | null;
  @ApiProperty() documentAvailable!: boolean;
}

export class CustomerPortalOperationDetailsSchema extends CustomerPortalOperationItemSchema {
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) startedAt!: string | null;
  @ApiProperty({ isArray: true }) timeline!: object[];
}

export class CustomerPortalOperationPageSchema {
  @ApiProperty({ type: CustomerPortalOperationItemSchema, isArray: true })
  data!: CustomerPortalOperationItemSchema[];
  @ApiProperty({ type: PortalPaginationSchema }) meta!: PortalPaginationSchema;
}

class CustomerPortalAssetItemSchema {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() category!: string;
  @ApiPropertyOptional({ nullable: true }) manufacturer!: string | null;
  @ApiPropertyOptional({ nullable: true }) model!: string | null;
  @ApiPropertyOptional({ nullable: true }) serialNumber!: string | null;
  @ApiPropertyOptional({ nullable: true }) identifier!: string | null;
  @ApiPropertyOptional({ nullable: true }) location!: string | null;
  @ApiProperty({ type: PortalStatusSchema }) status!: PortalStatusSchema;
  @ApiProperty({ type: PortalBusinessUnitSchema })
  businessUnit!: PortalBusinessUnitSchema;
}

export class CustomerPortalAssetDetailsSchema extends CustomerPortalAssetItemSchema {
  @ApiPropertyOptional({ nullable: true }) installedOn!: string | null;
  @ApiPropertyOptional({ nullable: true }) warrantyUntil!: string | null;
  @ApiProperty() related!: object;
}

export class CustomerPortalAssetPageSchema {
  @ApiProperty({ type: CustomerPortalAssetItemSchema, isArray: true })
  data!: CustomerPortalAssetItemSchema[];
  @ApiProperty({ type: PortalPaginationSchema }) meta!: PortalPaginationSchema;
}

class CustomerPortalPmocItemSchema {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: PortalStatusSchema }) status!: PortalStatusSchema;
  @ApiProperty({ type: PortalStatusSchema }) compliance!: PortalStatusSchema;
  @ApiProperty() startsOn!: string;
  @ApiPropertyOptional({ nullable: true }) endsOn!: string | null;
  @ApiPropertyOptional({ nullable: true }) nextDueOn!: string | null;
  @ApiProperty() frequency!: string;
  @ApiProperty() coveredAssets!: number;
  @ApiProperty({ type: PortalBusinessUnitSchema })
  businessUnit!: PortalBusinessUnitSchema;
}

export class CustomerPortalPmocDetailsSchema extends CustomerPortalPmocItemSchema {
  @ApiProperty({ isArray: true }) cycles!: object[];
}

export class CustomerPortalPmocPageSchema {
  @ApiProperty({ type: CustomerPortalPmocItemSchema, isArray: true })
  data!: CustomerPortalPmocItemSchema[];
  @ApiProperty({ type: PortalPaginationSchema }) meta!: PortalPaginationSchema;
}

class CustomerPortalRvtItemSchema {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() visitType!: string;
  @ApiProperty() schedule!: string;
  @ApiProperty({ type: PortalStatusSchema }) status!: PortalStatusSchema;
  @ApiProperty() coverageStart!: string;
  @ApiPropertyOptional({ nullable: true }) coverageEnd!: string | null;
  @ApiProperty() timezone!: string;
  @ApiProperty() plannedVisits!: number;
  @ApiProperty() completedVisits!: number;
  @ApiPropertyOptional({ nullable: true }) nextVisitAt!: string | null;
}

export class CustomerPortalRvtDetailsSchema extends CustomerPortalRvtItemSchema {
  @ApiProperty({ isArray: true }) visits!: object[];
}

export class CustomerPortalRvtPageSchema {
  @ApiProperty({ type: CustomerPortalRvtItemSchema, isArray: true })
  data!: CustomerPortalRvtItemSchema[];
  @ApiProperty({ type: PortalPaginationSchema }) meta!: PortalPaginationSchema;
}

class CustomerPortalDocumentSchema {
  @ApiProperty() id!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() type!: string;
  @ApiProperty() source!: string;
  @ApiProperty() issuedAt!: string;
  @ApiProperty({ type: PortalStatusSchema }) availability!: PortalStatusSchema;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() mimeType!: string;
}

export class CustomerPortalDocumentPageSchema {
  @ApiProperty({ type: CustomerPortalDocumentSchema, isArray: true })
  data!: CustomerPortalDocumentSchema[];
  @ApiProperty({ type: PortalPaginationSchema }) meta!: PortalPaginationSchema;
}

export class CustomerPortalDocumentAccessSchema {
  @ApiProperty() url!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ enum: ['GET'] }) method!: 'GET';
}
