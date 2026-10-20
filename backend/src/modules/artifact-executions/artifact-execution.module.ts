import { Module } from '@nestjs/common';
import { ArtifactAttachmentService } from './artifact-attachment.service';
import { ArtifactExecutionController } from './artifact-execution.controller';
import { ArtifactExecutionReadModelMapper } from './artifact-execution.mapper';
import { ArtifactExecutionPolicy } from './artifact-execution.policy';
import { ArtifactExecutionProgressCalculator } from './artifact-execution.progress';
import { ArtifactExecutionRepository } from './artifact-execution.repository';
import { ArtifactExecutionService } from './artifact-execution.service';
import { ArtifactExecutionStateMachine } from './artifact-execution.state-machine';
import { ArtifactExecutionValidator } from './artifact-execution.validator';
import { WorkforceModule } from '../workforce/workforce.module';

@Module({
  imports: [WorkforceModule],
  controllers: [ArtifactExecutionController],
  providers: [
    ArtifactExecutionService,
    ArtifactExecutionRepository,
    ArtifactExecutionReadModelMapper,
    ArtifactExecutionProgressCalculator,
    ArtifactExecutionStateMachine,
    ArtifactExecutionValidator,
    ArtifactExecutionPolicy,
    ArtifactAttachmentService,
  ],
  /** O repositório é exportado para o Manifest ler a execução sob RLS. */
  exports: [ArtifactExecutionService, ArtifactExecutionRepository],
})
export class ArtifactExecutionModule {}
