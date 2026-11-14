import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ArtifactRenderingModule } from '../artifact-rendering/artifact-rendering.module';
import { WorkforceModule } from '../workforce/workforce.module';
import { RvtController } from './rvt.controller';
import { RvtMapper } from './rvt.mapper';
import { RvtRepository } from './rvt.repository';
import { RvtService } from './rvt.service';

@Module({
  imports: [WorkforceModule, ArtifactRenderingModule, NotificationsModule],
  controllers: [RvtController],
  providers: [RvtRepository, RvtMapper, RvtService],
  exports: [RvtService, RvtRepository],
})
export class RvtModule {}
