import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { IsOptional } from 'class-validator';
import { MobileManagement } from '../../common/mobile-management';
import { Permissions } from '../../decorators';
import { PaginationDto } from '../../dtos';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import { IsUUIDv7 } from '../../validators';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { ReceiptDeliveryService } from './receipt-delivery.service';

class ReceiptListQueryDto extends PaginationDto {
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;
}

@Controller('financial/receipts')
@RequiresActivePlan()
export class ReceiptDeliveryController {
  constructor(private readonly receiptDelivery: ReceiptDeliveryService) {}

  @Get()
  @MobileManagement('receipts')
  @Capabilities('financial.read')
  @Permissions('financial.manage')
  listReceipts(
    @Req() request: IdentityRequest,
    @Query() query: ReceiptListQueryDto,
  ) {
    return this.receiptDelivery.list(
      this.receiptActor(request),
      query.page,
      query.limit,
      query.businessUnitId,
    );
  }

  @Post(':id/render')
  @MobileManagement('receipts')
  @HttpCode(HttpStatus.ACCEPTED)
  @Capabilities('financial.manage', 'artifact_rendering.render')
  @Permissions('financial.manage', 'artifact_rendering.render')
  renderReceipt(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.receiptDelivery.render(id, this.receiptActor(request));
  }

  @Get(':id/download')
  @MobileManagement('receipts')
  @Capabilities('financial.read', 'artifact_manifests.read')
  @Permissions('financial.manage', 'artifact_manifests.read')
  downloadReceipt(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.receiptDelivery.download(id, this.receiptActor(request));
  }

  private receiptActor(request: IdentityRequest) {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Selecione uma organização.');
    return {
      organizationId: identity.organizationId,
      actorId: identity.id,
      unitIds: identity.businessUnitIds,
      ownOnly: Boolean(
        request.mobileManagementAllowed &&
        identity.organizationRoles?.includes('FIELD_TECHNICIAN'),
      ),
    };
  }
}
