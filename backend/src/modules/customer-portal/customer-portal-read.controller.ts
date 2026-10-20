import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiPublicErrors } from '../../common/public-errors';
import { Public } from '../../decorators';
import { UnauthorizedException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import {
  CustomerPortalAssetListQueryDto,
  CustomerPortalDocumentListQueryDto,
  CustomerPortalOperationListQueryDto,
  CustomerPortalPmocListQueryDto,
  CustomerPortalRvtListQueryDto,
} from './customer-portal-read.dto';
import {
  CustomerPortalAssetDetailsSchema,
  CustomerPortalAssetPageSchema,
  CustomerPortalDashboardSchema,
  CustomerPortalDocumentAccessSchema,
  CustomerPortalDocumentPageSchema,
  CustomerPortalOperationDetailsSchema,
  CustomerPortalOperationPageSchema,
  CustomerPortalPmocDetailsSchema,
  CustomerPortalPmocPageSchema,
  CustomerPortalRvtDetailsSchema,
  CustomerPortalRvtPageSchema,
} from './customer-portal-read.openapi';
import { CustomerPortalReadService } from './customer-portal-read.service';
import {
  CustomerPortalGuard,
  type CustomerPortalRequest,
} from './customer-portal.guard';

@Public()
@ApiPublicErrors()
@UseGuards(CustomerPortalGuard)
@ApiBearerAuth('customer-portal')
@ApiTags('Customer Portal Read Models')
@ApiUnauthorizedResponse({ description: 'Sessão Portal inválida ou expirada' })
@Controller({ path: 'portal/me', version: '1' })
export class CustomerPortalReadController {
  constructor(private readonly reads: CustomerPortalReadService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Resumo operacional do Customer autenticado' })
  @ApiOkResponse({ type: CustomerPortalDashboardSchema })
  summary(@Req() request: CustomerPortalRequest) {
    return this.reads.dashboard(this.actor(request));
  }

  @Get('operations')
  @ApiOperation({ summary: 'Atendimentos do Customer autenticado' })
  @ApiOkResponse({ type: CustomerPortalOperationPageSchema })
  operations(
    @Req() request: CustomerPortalRequest,
    @Query() query: CustomerPortalOperationListQueryDto,
  ) {
    return this.reads.operations(this.actor(request), query);
  }

  @Get('operations/:id')
  @ApiOperation({ summary: 'Detalhes sanitizados de um atendimento próprio' })
  @ApiOkResponse({ type: CustomerPortalOperationDetailsSchema })
  @ApiNotFoundResponse({
    description: 'Ausente ou pertencente a outro Customer',
  })
  operation(
    @Req() request: CustomerPortalRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.reads.operation(this.actor(request), id);
  }

  @Get('assets')
  @ApiOperation({ summary: 'Equipamentos do Customer autenticado' })
  @ApiOkResponse({ type: CustomerPortalAssetPageSchema })
  assets(
    @Req() request: CustomerPortalRequest,
    @Query() query: CustomerPortalAssetListQueryDto,
  ) {
    return this.reads.assets(this.actor(request), query);
  }

  @Get('assets/:id')
  @ApiOperation({ summary: 'Detalhes de um equipamento próprio' })
  @ApiOkResponse({ type: CustomerPortalAssetDetailsSchema })
  @ApiNotFoundResponse({
    description: 'Ausente ou pertencente a outro Customer',
  })
  asset(
    @Req() request: CustomerPortalRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.reads.asset(this.actor(request), id);
  }

  @Get('pmoc')
  @ApiOperation({ summary: 'Planos PMOC do Customer autenticado' })
  @ApiOkResponse({ type: CustomerPortalPmocPageSchema })
  pmoc(
    @Req() request: CustomerPortalRequest,
    @Query() query: CustomerPortalPmocListQueryDto,
  ) {
    return this.reads.pmoc(this.actor(request), query);
  }

  @Get('pmoc/:id')
  @ApiOperation({ summary: 'Plano PMOC próprio com ciclos sanitizados' })
  @ApiOkResponse({ type: CustomerPortalPmocDetailsSchema })
  @ApiNotFoundResponse({
    description: 'Ausente ou pertencente a outro Customer',
  })
  pmocDetails(
    @Req() request: CustomerPortalRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.reads.pmocDetails(this.actor(request), id);
  }

  @Get('rvt')
  @ApiOperation({ summary: 'Programações RVT do Customer autenticado' })
  @ApiOkResponse({ type: CustomerPortalRvtPageSchema })
  rvt(
    @Req() request: CustomerPortalRequest,
    @Query() query: CustomerPortalRvtListQueryDto,
  ) {
    return this.reads.rvt(this.actor(request), query);
  }

  @Get('rvt/:id')
  @ApiOperation({ summary: 'Programação RVT própria e suas visitas' })
  @ApiOkResponse({ type: CustomerPortalRvtDetailsSchema })
  @ApiNotFoundResponse({
    description: 'Ausente ou pertencente a outro Customer',
  })
  rvtDetails(
    @Req() request: CustomerPortalRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.reads.rvtDetails(this.actor(request), id);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Documentos finais liberados ao Customer' })
  @ApiOkResponse({ type: CustomerPortalDocumentPageSchema })
  documents(
    @Req() request: CustomerPortalRequest,
    @Query() query: CustomerPortalDocumentListQueryDto,
  ) {
    return this.reads.documents(this.actor(request), query);
  }

  @Get('documents/:id/access')
  @ApiOperation({ summary: 'Gera acesso temporário a documento próprio' })
  @ApiOkResponse({ type: CustomerPortalDocumentAccessSchema })
  @ApiNotFoundResponse({ description: 'Ausente, indisponível ou estrangeiro' })
  documentAccess(
    @Req() request: CustomerPortalRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    return this.reads.documentAccess(this.actor(request), id);
  }

  private actor(request: CustomerPortalRequest) {
    if (!request.portalActor) throw new UnauthorizedException();
    return request.portalActor;
  }
}
