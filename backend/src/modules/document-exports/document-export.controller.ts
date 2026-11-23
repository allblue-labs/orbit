import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Surfaces } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import { RequiresActivePlan } from '../subscription-plans/plan-access';
import type { DocumentExportReadModel } from './document-export.read-models';
import { DocumentExportService } from './document-export.service';

/**
 * Consulta de uma exportação — web e app usam a mesma rota.
 *
 * A permissão de ver é decidida no serviço: quem pediu sempre vê; outra
 * pessoa precisa da leitura do tipo de documento.
 */
@ApiTags('Document exports')
@Controller('document-exports')
@Surfaces('WEB', 'MOBILE', 'API')
@RequiresActivePlan()
export class DocumentExportController {
  constructor(private readonly exports: DocumentExportService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Export status; a 300 s signed download URL once completed',
  })
  status(
    @Param('id', ParseUUIDv7Pipe) id: string,
  ): Promise<DocumentExportReadModel> {
    return this.exports.status(id);
  }
}
