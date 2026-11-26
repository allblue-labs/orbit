import { Module } from '@nestjs/common';
import { CorporateAdministrationController } from './corporate-administration.controller';
import { CorporateTenantLifecycleController } from './corporate-tenant-lifecycle.controller';
import { CorporateOrganizationsController } from './corporate-organizations.controller';
import { PlatformAdministrationModule } from '../platform-administration/platform-administration.module';
import {
  CorporateCapabilityGuard,
  TechnicalAuthenticationGuard,
} from './corporate-access.guard';
import { TechnicalCredentialService } from './technical-credential.service';

@Module({
  imports: [PlatformAdministrationModule],
  controllers: [
    CorporateAdministrationController,
    CorporateOrganizationsController,
    CorporateTenantLifecycleController,
  ],
  providers: [
    TechnicalCredentialService,
    TechnicalAuthenticationGuard,
    CorporateCapabilityGuard,
  ],
})
export class CorporateAdministrationModule {}
