import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PortalOrganizationSchema {
  @ApiProperty() id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() displayName!: string;
}

class PortalCustomerSchema {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
}

class PortalIdentitySchema {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: ['invited', 'active', 'disabled'] }) status!: string;
  @ApiPropertyOptional({ nullable: true }) contactId!: string | null;
}

export class CustomerPortalMeSchema {
  @ApiProperty({ enum: ['CUSTOMER_PORTAL'] }) actorType!: string;
  @ApiProperty({ type: PortalIdentitySchema }) identity!: PortalIdentitySchema;
  @ApiProperty({ type: PortalOrganizationSchema })
  organization!: PortalOrganizationSchema;
  @ApiProperty({ type: PortalCustomerSchema }) customer!: PortalCustomerSchema;
  @ApiProperty() sessionId!: string;
}

export class CustomerPortalSessionSchema {
  @ApiProperty() accessToken!: string;
  @ApiProperty() refreshToken!: string;
  @ApiProperty({ example: 'Bearer' }) tokenType!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
  @ApiProperty({ type: CustomerPortalMeSchema }) me!: CustomerPortalMeSchema;
}

export class CustomerPortalInvitationSchema {
  @ApiProperty() id!: string;
  @ApiProperty() identityId!: string;
  @ApiProperty() customerId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() email!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ enum: ['invited'] }) status!: string;
}

export class PortalMessageSchema {
  @ApiProperty() message!: string;
}
