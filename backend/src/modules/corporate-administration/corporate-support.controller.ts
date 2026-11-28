import { ExpandAdministrativeDetailDto } from './corporate-completion.dto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
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
import { CorporateDiagnosticsService } from './corporate-diagnostics.service';
import { corporateValidation } from './corporate-request';
import {
  CreateSupportTicketDto,
  DiagnosticOperationsQuery,
  ResumeSupportProvisioningDto,
  SupportNoteDto,
  SupportTicketsQuery,
  TicketInteractionsQuery,
  UpdateSupportTicketDto,
} from './corporate-support.dto';
import { CorporateSupportTicketsService } from './corporate-support-tickets.service';
import {
  DIAGNOSTICS_INTEGRATIONS_READ,
  DIAGNOSTICS_OPERATIONS_READ,
  DIAGNOSTICS_ORGANIZATIONS_READ,
  RECOVERY_PROVISIONING_RESUME,
  SUPPORT_TICKETS_CREATE,
  SUPPORT_TICKETS_READ,
  SUPPORT_TICKETS_UPDATE,
} from './technical-credential.service';

@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin', version: '1' })
export class CorporateSupportController {
  constructor(
    private readonly tickets: CorporateSupportTicketsService,
    private readonly diagnostics: CorporateDiagnosticsService,
  ) {}

  @Get('support/tickets')
  @RequiresCorporateCapability(SUPPORT_TICKETS_READ)
  list(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: SupportTicketsQuery,
  ) {
    return this.tickets.list(call, reference, query);
  }

  @Get('support/tickets/:id')
  @RequiresCorporateCapability(SUPPORT_TICKETS_READ)
  detail(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(corporateValidation) query: TicketInteractionsQuery,
  ) {
    return this.tickets.detail(call, reference, id.toLowerCase(), query);
  }

  @Post('support/tickets')
  @RequiresCorporateCapability(SUPPORT_TICKETS_CREATE)
  create(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body(corporateValidation) dto: CreateSupportTicketDto,
  ) {
    return this.tickets.create(call, reference, key, dto);
  }

  @Patch('support/tickets/:id')
  @RequiresCorporateCapability(SUPPORT_TICKETS_UPDATE)
  update(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: unknown,
    @Body(corporateValidation) dto: UpdateSupportTicketDto,
  ) {
    return this.tickets.update(call, reference, id.toLowerCase(), key, dto);
  }

  @Post('support/tickets/:id/notes')
  @RequiresCorporateCapability(SUPPORT_TICKETS_UPDATE)
  note(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') key: unknown,
    @Body(corporateValidation) dto: SupportNoteDto,
  ) {
    return this.tickets.note(call, reference, id.toLowerCase(), key, dto);
  }

  @Get('organizations/:id/diagnostics')
  @RequiresCorporateCapability(DIAGNOSTICS_ORGANIZATIONS_READ)
  organization(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.diagnostics.organization(call, reference, id.toLowerCase());
  }

  @Get('diagnostics/integrations')
  @RequiresCorporateCapability(DIAGNOSTICS_INTEGRATIONS_READ)
  integrations(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
  ) {
    return this.diagnostics.integrations(call, reference);
  }

  @Get('diagnostics/operations')
  @RequiresCorporateCapability(DIAGNOSTICS_OPERATIONS_READ)
  operations(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: DiagnosticOperationsQuery,
  ) {
    return this.diagnostics.operations(call, reference, query);
  }

  @Get('diagnostics/operations/:id')
  @RequiresCorporateCapability(DIAGNOSTICS_OPERATIONS_READ)
  operation(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id') id: string,
    @Query(corporateValidation) query: ExpandAdministrativeDetailDto,
  ) {
    return this.diagnostics.operation(
      call,
      reference,
      id,
      query.includeDetails === 'true',
    );
  }

  @Post('diagnostics/provisionings/:id/resume')
  @RequiresCorporateCapability(RECOVERY_PROVISIONING_RESUME)
  async resume(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(corporateValidation) dto: ResumeSupportProvisioningDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.diagnostics.resume(
      call,
      reference,
      id.toLowerCase(),
      key,
      dto,
    );
    response.status(result.complete ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result;
  }
}
