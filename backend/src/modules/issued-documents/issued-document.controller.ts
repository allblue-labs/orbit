import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { IssuedDocumentQueryDto } from './issued-document.dto';
import { IssuedDocumentService } from './issued-document.service';

/**
 * O que a organização emitiu — pelos dois motores.
 *
 * ## Por que não é uma rota do módulo de execuções
 *
 * Porque a resposta não é de execuções. Metade dela vem de `reports`, e pendurar
 * essa leitura no módulo de artefatos faria o módulo responder por um documento
 * que ele não emitiu — a mesma confusão que a separação entre Reports Center e
 * Document Center existe para evitar.
 *
 * ## As duas capacidades
 *
 * A resposta mistura as duas origens, então quem pergunta precisa poder ver as
 * duas. Pedir só uma devolveria a alguém uma lista com linhas que ele não deveria
 * enxergar — e filtrar por capacidade dentro da consulta faria `total` depender de
 * quem pergunta, o que paginação não suporta.
 */
@ApiTags('Issued Documents')
@Controller('issued-documents')
@RequiresActivePlan()
export class IssuedDocumentController {
  constructor(private readonly documents: IssuedDocumentService) {}

  @Get()
  @Capabilities('artifact_executions.read', 'reports.management.read')
  @Permissions('artifact_executions.read', 'reports.management.read')
  @ApiOperation({
    summary:
      'Documentos emitidos: execuções de artefato e relatórios gerenciais',
  })
  list(
    @Req() request: IdentityRequest,
    @Query() query: IssuedDocumentQueryDto,
  ) {
    return this.documents.list(this.org(request), query);
  }

  private org(request: IdentityRequest): string {
    const id = request.identity?.organizationId;
    if (!id) throw new ForbiddenException('Organization context is required');
    return id;
  }
}
