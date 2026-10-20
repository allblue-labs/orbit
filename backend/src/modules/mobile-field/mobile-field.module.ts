import { Module } from '@nestjs/common';
import { OperationsModule } from '../operations/operations.module';
import { PrismaModule } from '../../database';
import { MobileFieldController } from './mobile-field.controller';
import { MobileFieldRepository } from './mobile-field.repository';
import { MobileFieldService } from './mobile-field.service';
import { InventoryModule } from '../inventory/inventory.module';
import { MobileFieldOperationController } from './mobile-field-operation.controller';
import { MobileFieldOperationRepository } from './mobile-field-operation.repository';
import { MobileFieldOperationService } from './mobile-field-operation.service';
import { MobileSignatureController } from './mobile-signature.controller';
import { ProfessionalSignatureController } from './professional-signature.controller';
import { MobileSignatureRepository } from './mobile-signature.repository';
import { MobileSignatureService } from './mobile-signature.service';
import { MobileOfflineSyncController } from './mobile-offline-sync.controller';
import { MobileOfflineSyncRepository } from './mobile-offline-sync.repository';
import { MobileOfflineSyncService } from './mobile-offline-sync.service';
import { MobileSyncCleanupProcessor } from './mobile-sync-cleanup.processor';
import { MobileEvidenceController } from './mobile-evidence.controller';
import { MobileEvidenceRepository } from './mobile-evidence.repository';
import { MobileEvidenceService } from './mobile-evidence.service';
import { MobileEvidenceCleanupProcessor } from './mobile-evidence-cleanup.processor';
import { ArtifactRenderingModule } from '../artifact-rendering/artifact-rendering.module';
import { ArtifactManifestModule } from '../artifact-manifests/artifact-manifest.module';
import { MobileFieldArtifactController } from './mobile-field-artifact.controller';
import { MobileFieldArtifactRepository } from './mobile-field-artifact.repository';
import { MobileFieldArtifactService } from './mobile-field-artifact.service';

@Module({
  imports: [
    PrismaModule,
    InventoryModule,
    ArtifactRenderingModule,
    ArtifactManifestModule,
    /* O pedido de cancelamento nasce no aplicativo, mas a regra de quem pode
       pedir é do domínio de operações — e é de lá que o serviço vem. */
    OperationsModule,
  ],
  controllers: [
    MobileFieldController,
    MobileFieldOperationController,
    MobileSignatureController,
    ProfessionalSignatureController,
    MobileOfflineSyncController,
    MobileEvidenceController,
    MobileFieldArtifactController,
  ],
  providers: [
    MobileFieldRepository,
    MobileFieldService,
    MobileFieldOperationRepository,
    MobileFieldOperationService,
    MobileSignatureRepository,
    MobileSignatureService,
    MobileOfflineSyncRepository,
    MobileOfflineSyncService,
    MobileSyncCleanupProcessor,
    MobileEvidenceRepository,
    MobileEvidenceService,
    MobileEvidenceCleanupProcessor,
    MobileFieldArtifactRepository,
    MobileFieldArtifactService,
  ],
  exports: [MobileFieldService, MobileFieldOperationService],
})
export class MobileFieldModule {}
