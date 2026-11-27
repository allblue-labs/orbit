import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CorporateCommercialController } from './corporate-commercial.controller';
import { CorporateCommercialService } from './corporate-commercial.service';
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
  imports: [PlatformAdministrationModule, BillingModule],
  controllers: [
    CorporateAdministrationController,
    CorporateOrganizationsController,
    CorporateTenantLifecycleController,
    CorporateCommercialController,
  ],
  providers: [
    TechnicalCredentialService,
    CorporateCommercialService,
    TechnicalAuthenticationGuard,
    CorporateCapabilityGuard,
  ],
})
export class CorporateAdministrationModule {}
