import { Module } from '@nestjs/common';
import { OperationController } from './operation.controller';
import { OperationRepository } from './operation.repository';
import { OperationService } from './operation.service';
import { OperationStorageService } from './operation-storage.service';
import { ChecklistController } from './checklist.controller';
import { ChecklistRepository } from './checklist.repository';
import { ChecklistService } from './checklist.service';
import { OperationReadModelMapper } from './operation.mapper';
import { OperationCancellationController } from './operation-cancellation.controller';
import { OperationCancellationRepository } from './operation-cancellation.repository';
import { OperationCancellationService } from './operation-cancellation.service';
import { WorkforceModule } from '../workforce/workforce.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  /* `StorageModule` porque o registro de campo assina as URLs das imagens: a
     evidência e a assinatura do cliente moram no storage, não no banco. */
  imports: [WorkforceModule, NotificationsModule, StorageModule],
  controllers: [
    OperationController,
    ChecklistController,
    OperationCancellationController,
  ],
  providers: [
    OperationRepository,
    OperationService,
    OperationStorageService,
    ChecklistRepository,
    ChecklistService,
    OperationReadModelMapper,
    OperationCancellationRepository,
    OperationCancellationService,
  ],
  /* `OperationCancellationService` sai do módulo porque o aplicativo de campo é
     quem cria o pedido — a rota dele vive em `mobile-field`, e a regra de quem
     pode pedir mora aqui, junto do domínio de operações. */
  exports: [
    OperationService,
    OperationRepository,
    ChecklistService,
    OperationCancellationService,
  ],
})
export class OperationsModule {}
