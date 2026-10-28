import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Ip,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Permissions, Public } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { QuoteAcceptanceService } from './quote-acceptance.service';
import { QuoteAcceptanceResponseDto } from './quote-acceptance.dto';

@Controller('quotes')
@RequiresActivePlan()
export class QuoteAcceptanceController {
  constructor(private readonly acceptance: QuoteAcceptanceService) {}
  @Post(':id/acceptance-link')
  @Capabilities('quotes.manage')
  @Permissions('quotes.send')
  create(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    const identity = request.identity;
    if (!identity?.organizationId)
      throw new ForbiddenException('Selecione uma organização.');
    return this.acceptance.create(id, identity.organizationId, identity.id);
  }
  @Get(':id/customer-response')
  @Capabilities('quotes.read')
  @Permissions('quotes.read')
  latest(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    const organizationId = request.identity?.organizationId;
    if (!organizationId)
      throw new ForbiddenException('Selecione uma organização.');
    return this.acceptance.latest(id, organizationId);
  }
}

@Controller('public/quotes/proposals')
export class QuotePublicAcceptanceController {
  constructor(private readonly acceptance: QuoteAcceptanceService) {}
  @Get(':token')
  @Public()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  read(@Param('token') token: string) {
    return this.acceptance.read(token);
  }
  @Post(':token/response')
  @Public()
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  respond(
    @Param('token') token: string,
    @Body() input: QuoteAcceptanceResponseDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.acceptance.respond(token, input, { ip, userAgent });
  }
  @Get(':token/document')
  @Public()
  async document(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const document = await this.acceptance.document(token);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${document.fileName}"`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    return new StreamableFile(document.bytes);
  }
}
