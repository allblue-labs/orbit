import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PlatformAdministrationController } from './platform-administration.controller';
import { PlatformAdministrationRepository } from './platform-administration.repository';
import { PlatformAdministrationService } from './platform-administration.service';

@Module({
  imports: [IdentityModule],
  controllers: [PlatformAdministrationController],
  providers: [PlatformAdministrationRepository, PlatformAdministrationService],
  exports: [PlatformAdministrationRepository, PlatformAdministrationService],
})
export class PlatformAdministrationModule {}
