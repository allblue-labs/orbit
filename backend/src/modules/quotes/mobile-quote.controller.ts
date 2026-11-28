import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { Idempotent } from '../../common/hotpath/idempotent.decorator';
import { CreateAssetDto } from '../organizations/business-units/equipaments/asset.dto';
import { Surfaces } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { CreateMobileQuoteDto, MobileQuoteQueryDto } from './mobile-quote.dto';
import { MobileQuoteService } from './mobile-quote.service';
import { QuoteDocumentExports } from './quote-document-exports';

@Controller('mobile/field/quotes')
@Surfaces('MOBILE')
@RequiresActivePlan()
@Capabilities('quotes.manage')
export class MobileQuoteController {
  constructor(
    private readonly service: MobileQuoteService,
    private readonly documentExports: QuoteDocumentExports,
  ) {}

  @Get('customers/:customerId/options')
  options(
    @Req() request: IdentityRequest,
    @Param('customerId', ParseUUIDv7Pipe) customerId: string,
    @Query() query: MobileQuoteQueryDto,
  ) {
    return this.service.options(
      this.actor(request),
      customerId,
      query.businessUnitId,
    );
  }

  @Post('customers/:customerId/equipment')
  createEquipment(
    @Req() request: IdentityRequest,
    @Param('customerId', ParseUUIDv7Pipe) customerId: string,
    @Body() input: CreateAssetDto,
  ) {
    return this.service.createEquipment(this.actor(request), customerId, input);
  }

  @Get('catalog')
  catalog(
    @Req() request: IdentityRequest,
    @Query() query: MobileQuoteQueryDto,
  ) {
    return this.service.catalog(
      this.actor(request),
      query.search,
      query.businessUnitId,
    );
  }

  @Post()
  @Idempotent('mobile.quote.create', 'mobile-quote')
  create(@Req() request: IdentityRequest, @Body() input: CreateMobileQuoteDto) {
    return this.service.create(this.actor(request), input);
  }

  @Post(':id/acceptance-link')
  link(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.service.link(this.actor(request), id);
  }

  /** Exportação assíncrona (202); a rota síncrona abaixo continua valendo. */
  @Post(':id/document/exports')
  @HttpCode(HttpStatus.ACCEPTED)
  @Capabilities('quotes.read')
  exportDocument(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.documentExports.requestFromMobile(this.actor(request), id);
  }

  @Get(':id/document')
  @Capabilities('quotes.read')
  async document(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const document = await this.service.document(this.actor(request), id);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${document.fileName}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(document.bytes);
  }

  private actor(request: IdentityRequest) {
    if (!request.identity?.organizationId)
      throw new ForbiddenException('Selecione uma organização.');
    return request.identity;
  }
}
