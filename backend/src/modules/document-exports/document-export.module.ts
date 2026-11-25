/**
 * Exportação assíncrona de documentos.
 *
 * Global: os domínios (orçamentos, PMOC, equipamentos) injetam o serviço para
 * expor as rotas `POST …/exports` e registram seus geradores no registro —
 * sem que este módulo importe nenhum deles.
 */
import { Global, Module } from '@nestjs/common';
import { DocumentExportCleanupProcessor } from './document-export-cleanup.processor';
import { DocumentExportController } from './document-export.controller';
import { DocumentExportProcessor } from './document-export.processor';
import { DocumentExportGeneratorRegistry } from './document-export.registry';
import { DocumentExportService } from './document-export.service';

@Global()
@Module({
  controllers: [DocumentExportController],
  providers: [
    DocumentExportService,
    DocumentExportGeneratorRegistry,
    DocumentExportProcessor,
    DocumentExportCleanupProcessor,
  ],
  exports: [DocumentExportService, DocumentExportGeneratorRegistry],
})
export class DocumentExportModule {}
