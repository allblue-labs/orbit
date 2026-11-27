import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../decorators';
import {
  CorporateCaller,
  CorporateCapabilityGuard,
  RequiresCorporateCapability,
  TechnicalAuthenticationGuard,
  type CorporateCall,
} from './corporate-access.guard';
import { corporateValidation } from './corporate-request';
import {
  CreatePromotionDto,
  PromotionListDto,
  PromotionVersionDto,
  RedemptionListDto,
  UpdatePromotionDto,
} from './corporate-promotions.dto';
import {
  CorporatePromotionsService,
  type PromotionWrite,
} from './corporate-promotions.service';
import {
  PROMOTIONS_READ,
  PROMOTIONS_CREATE,
  PROMOTIONS_UPDATE,
  PROMOTIONS_ACTIVATE,
  PROMOTIONS_DEACTIVATE,
} from './technical-credential.service';

@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin/promotions', version: '1' })
export class CorporatePromotionsController {
  constructor(private readonly promotions: CorporatePromotionsService) {}

  @Get()
  @RequiresCorporateCapability(PROMOTIONS_READ)
  list(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: PromotionListDto,
  ) {
    return this.promotions.list(call, reference, query);
  }

  @Get(':id')
  @RequiresCorporateCapability(PROMOTIONS_READ)
  detail(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.promotions.detail(call, reference, id.toLowerCase());
  }

  @Get(':id/redemptions')
  @RequiresCorporateCapability(PROMOTIONS_READ)
  redemptions(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(corporateValidation) query: RedemptionListDto,
  ) {
    return this.promotions.redemptions(
      call,
      reference,
      id.toLowerCase(),
      query,
    );
  }

  @Post()
  @RequiresCorporateCapability(PROMOTIONS_CREATE)
  create(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body(corporateValidation) input: CreatePromotionDto,
  ) {
    return this.promotions.write(call, reference, key, {
      operation: 'CREATE',
      input,
    });
  }

  @Patch(':id')
  @RequiresCorporateCapability(PROMOTIONS_UPDATE)
  update(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(corporateValidation) input: UpdatePromotionDto,
  ) {
    return this.promotions.write(call, reference, key, {
      operation: 'UPDATE',
      id: id.toLowerCase(),
      input,
    });
  }

  @Post(':id/activate')
  @RequiresCorporateCapability(PROMOTIONS_ACTIVATE)
  activate(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(corporateValidation) input: PromotionVersionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.sync(
      call,
      reference,
      key,
      { operation: 'ACTIVATE', id: id.toLowerCase(), input },
      response,
    );
  }

  @Post(':id/deactivate')
  @RequiresCorporateCapability(PROMOTIONS_DEACTIVATE)
  deactivate(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(corporateValidation) input: PromotionVersionDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.sync(
      call,
      reference,
      key,
      { operation: 'DEACTIVATE', id: id.toLowerCase(), input },
      response,
    );
  }

  private async sync(
    call: CorporateCall,
    reference: unknown,
    key: unknown,
    command: PromotionWrite,
    response: Response,
  ) {
    const result = await this.promotions.write(call, reference, key, command);
    response.status(result.pending ? 202 : 200);
    return result;
  }
}
