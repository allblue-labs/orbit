import { requestClientIp } from '../../common/trusted-client-origin';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { CreateSignatureDto, RevokeSignatureDto } from './signature.dto';
import { SignatureService } from './signature.service';

@ApiTags('Signatures')
@Controller('reports/:reportId/signatures')
@RequiresActivePlan()
export class SignatureController {
  constructor(private readonly signatures: SignatureService) {}

  @Get()
  @Capabilities('signatures.read')
  @Permissions('signatures.read')
  list(
    @Param('reportId', ParseUUIDv7Pipe) reportId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.signatures.list(reportId, this.organizationId(request));
  }

  @Post()
  @Capabilities('signatures.manage')
  @Permissions('signatures.create')
  sign(
    @Param('reportId', ParseUUIDv7Pipe) reportId: string,
    @Req() request: IdentityRequest,
    @Body() input: CreateSignatureDto,
  ) {
    return this.signatures.sign(
      reportId,
      this.organizationId(request),
      request.identity!.id,
      input,
      {
        ipAddress: requestClientIp(request),
        userAgent: request.header('user-agent'),
      },
    );
  }

  @Delete(':id')
  @Capabilities('signatures.manage')
  @Permissions('signatures.revoke')
  revoke(
    @Param('reportId', ParseUUIDv7Pipe) reportId: string,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: RevokeSignatureDto,
  ) {
    return this.signatures.revoke(
      id,
      reportId,
      this.organizationId(request),
      input.reason,
    );
  }

  private organizationId(request: IdentityRequest): string {
    const id = request.identity?.organizationId;
    if (!id) throw new ForbiddenException('Organization context is required');
    return id;
  }
}
