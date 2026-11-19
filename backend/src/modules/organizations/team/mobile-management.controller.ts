import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MOBILE_DELEGATIONS,
  MobileManagement,
  type MobileDelegation,
} from '../../../common/mobile-management';
import { RlsTransaction } from '../../../database';
import { Permissions, Surfaces } from '../../../decorators';
import {
  EntityNotFoundException,
  ForbiddenException,
} from '../../../exceptions';
import { IsUUIDv7 } from '../../../validators';
import { ParseUUIDv7Pipe } from '../../../pipes';
import type { IdentityRequest } from '../../identity/infrastructure/jwt-authentication.guard';
import { RecurringAuthorizationQueryDto } from '../../operations/dto/recurring-authorization.dto';
import { requiresAssignmentAuthorization } from '../../operations/operation-authorization';
import {
  Capabilities,
  RequiresActivePlan,
} from '../../subscription-plans/plan-access';
import { FIELD_TECHNICIAN_ROLE_KEY } from '../team-roles';

class UpdateMobileDelegationsDto {
  @IsArray()
  @ArrayMaxSize(MOBILE_DELEGATIONS.length)
  @ArrayUnique()
  @IsIn(MOBILE_DELEGATIONS, { each: true })
  areas!: MobileDelegation[];
}

class MobileOptionsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  search?: string;

  @IsOptional()
  @IsString()
  @IsUUIDv7()
  customerId?: string;
}

class MobileCustomerOptionsQuery extends MobileOptionsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

@Controller('mobile/owner')
@Surfaces('MOBILE')
export class MobileManagementController {
  constructor(private readonly rls: RlsTransaction) {}

  @Get('access')
  async access(@Req() request: IdentityRequest) {
    this.organizationId(request);
    const areas = request.mobileManagementAreas ?? [];
    if (!areas.includes('authorization'))
      return { areas, requiresAuthorization: false };
    const organization = await this.rls.run((tx) =>
      tx.organization.findUnique({
        where: { id: this.organizationId(request) },
        select: { settings: true },
      }),
    );
    return {
      areas,
      requiresAuthorization: requiresAssignmentAuthorization(
        organization?.settings,
      ),
    };
  }

  @Get('customers')
  @RequiresActivePlan()
  @MobileManagement(
    'operations',
    'quotes',
    'receipts',
    'sales',
    'finance',
    'equipment',
    'pmoc',
    'rvt',
  )
  async customers(
    @Req() request: IdentityRequest,
    @Query() query: MobileCustomerOptionsQuery,
  ) {
    const organizationId = this.organizationId(request);
    const term = query.search?.trim();
    const pageSize = 60;
    const page = query.page;
    const rows = await this.rls.run((tx) =>
      tx.customer.findMany({
        where: {
          organizationId,
          deletedAt: null,
          status: 'ACTIVE',
          ...(term
            ? {
                OR: [
                  { legalName: { contains: term, mode: 'insensitive' } },
                  { tradeName: { contains: term, mode: 'insensitive' } },
                  {
                    documentNumber: {
                      contains: term.replace(/[^0-9]/g, '') || term,
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ legalName: 'asc' }, { id: 'asc' }],
        skip: page === undefined ? undefined : (page - 1) * pageSize,
        take: page === undefined ? pageSize : pageSize + 1,
        select: {
          id: true,
          legalName: true,
          tradeName: true,
          documentNumber: request.mobileManagementAreas?.includes('receipts'),
        },
      }),
    );
    if (page === undefined) return rows;
    return {
      data: rows.slice(0, pageSize),
      hasNextPage: rows.length > pageSize,
    };
  }

  @Get('equipment')
  @RequiresActivePlan()
  @MobileManagement('operations', 'pmoc', 'rvt')
  equipment(
    @Req() request: IdentityRequest,
    @Query() query: MobileOptionsQuery,
  ) {
    if (!query.customerId) return [];
    return this.rls.run((tx) =>
      tx.asset.findMany({
        where: {
          organizationId: this.organizationId(request),
          customerId: query.customerId,
          deletedAt: null,
          ...(query.search?.trim()
            ? { name: { contains: query.search.trim(), mode: 'insensitive' } }
            : {}),
        },
        select: { id: true, name: true, businessUnitId: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 60,
      }),
    );
  }

  @Get('addresses')
  @RequiresActivePlan()
  @MobileManagement('operations', 'pmoc', 'rvt')
  addresses(
    @Req() request: IdentityRequest,
    @Query() query: MobileOptionsQuery,
  ) {
    if (!query.customerId) return [];
    return this.rls.run((tx) =>
      tx.customerAddress.findMany({
        where: {
          organizationId: this.organizationId(request),
          customerId: query.customerId,
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          label: true,
          street: true,
          number: true,
          district: true,
          complement: true,
          city: true,
          stateCode: true,
          postalCode: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { label: 'asc' }],
        take: 100,
      }),
    );
  }

  @Get('operation-authorizations')
  @RequiresActivePlan()
  @MobileManagement('authorization')
  @Capabilities('operations.read')
  @Permissions('operations.assign')
  operationAuthorizations(
    @Req() request: IdentityRequest,
    @Query() query: RecurringAuthorizationQueryDto,
  ) {
    const organizationId = this.organizationId(request);
    const unitIds = request.identity!.businessUnitIds.filter(
      (id) => !query.businessUnitId || id === query.businessUnitId,
    );
    return this.rls.run(async (tx) => {
      const organization = await tx.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
      });
      if (!requiresAssignmentAuthorization(organization?.settings))
        return { data: [], meta: { page: query.page, totalPages: 0 } };
      const term = query.search?.trim();
      const where = {
        organizationId,
        businessUnitId: { in: unitIds },
        deletedAt: null,
        serviceOrderNumber: { not: null },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        responsibleFieldTechnicianId: query.assignedUserId ?? { not: null },
        authorizedAt: query.state === 'authorized' ? { not: null } : null,
        ...(term
          ? {
              OR: [
                { title: { contains: term, mode: 'insensitive' as const } },
                { code: { contains: term, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const limit = 25;
      const data = await tx.operation.findMany({
        where,
        skip: (query.page - 1) * limit,
        take: limit,
        orderBy: [{ scheduledStart: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          code: true,
          scheduledStart: true,
          responsibleFieldTechnician: { select: { displayName: true } },
        },
      });
      const total = await tx.operation.count({ where });
      return {
        data,
        meta: { page: query.page, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  @Get('members/:userId/delegations')
  @RequiresActivePlan()
  @MobileManagement('team')
  async delegations(
    @Req() request: IdentityRequest,
    @Param('userId', ParseUUIDv7Pipe) userId: string,
  ) {
    this.assertOwner(request);
    const member = await this.rls.run((tx) =>
      tx.organizationMembership.findFirst({
        where: this.memberWhere(request, userId),
        select: { mobileDelegations: true },
      }),
    );
    if (!member) throw new EntityNotFoundException('Field technician');
    return { areas: member.mobileDelegations };
  }

  @Patch('members/:userId/delegations')
  @RequiresActivePlan()
  @MobileManagement('team')
  async updateDelegations(
    @Req() request: IdentityRequest,
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Body() input: UpdateMobileDelegationsDto,
  ) {
    this.assertOwner(request);
    const organizationId = this.organizationId(request);
    return this.rls.run(async (tx) => {
      const member = await tx.organizationMembership.updateMany({
        where: {
          ...this.memberWhere(request, userId),
          organization: { ownerUserId: request.identity!.id },
        },
        data: { mobileDelegations: input.areas },
      });
      if (!member.count) throw new EntityNotFoundException('Field technician');
      await tx.auditLog.create({
        data: {
          organizationId,
          userId: request.identity!.id,
          action: 'MOBILE_MANAGEMENT_DELEGATIONS_UPDATED',
          entityType: 'ORGANIZATION_MEMBERSHIP',
          entityId: userId,
          metadata: { areas: input.areas },
        },
      });
      return { areas: input.areas };
    });
  }

  private memberWhere(request: IdentityRequest, userId: string) {
    return {
      organizationId: this.organizationId(request),
      userId,
      deletedAt: null,
      status: 'ACTIVE',
      role: { key: FIELD_TECHNICIAN_ROLE_KEY, deletedAt: null },
      user: { status: 'ACTIVE', deletedAt: null },
    };
  }

  private organizationId(request: IdentityRequest) {
    if (request.sessionClient !== 'MOBILE' || !request.identity?.organizationId)
      throw new ForbiddenException(
        'É necessária uma sessão móvel da organização.',
      );
    return request.identity.organizationId;
  }

  private assertOwner(request: IdentityRequest) {
    if (!request.identity?.isOrganizationOwner)
      throw new ForbiddenException(
        'Somente o proprietário pode delegar acesso.',
      );
  }
}
