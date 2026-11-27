import { Module } from '@nestjs/common';
import { CorporateAnalyticsController } from './corporate-analytics.controller';
import { CorporateAnalyticsService } from './corporate-analytics.service';
import { CorporateSupportController } from './corporate-support.controller';
import { CorporateSupportAccess } from './corporate-support-access.service';
import { CorporateSupportTicketsService } from './corporate-support-tickets.service';
import { CorporateDiagnosticsService } from './corporate-diagnostics.service';
import { EmailModule } from '../email/email.module';
import { BillingModule } from '../billing/billing.module';
import { CorporateFinanceController } from './corporate-finance.controller';
import { CorporateFinanceService } from './corporate-finance.service';
import { CorporatePromotionsController } from './corporate-promotions.controller';
import { CorporatePromotionsService } from './corporate-promotions.service';
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
  imports: [PlatformAdministrationModule, BillingModule, EmailModule],
  controllers: [
    CorporateAdministrationController,
    CorporateOrganizationsController,
    CorporateTenantLifecycleController,
    CorporateCommercialController,
    CorporatePromotionsController,
    CorporateFinanceController,
    CorporateAnalyticsController,
    CorporateSupportController,
  ],
  providers: [
    TechnicalCredentialService,
    CorporateCommercialService,
    CorporatePromotionsService,
    CorporateFinanceService,
    CorporateAnalyticsService,
    CorporateSupportAccess,
    CorporateSupportTicketsService,
    CorporateDiagnosticsService,
    TechnicalAuthenticationGuard,
    CorporateCapabilityGuard,
  ],
})
export class CorporateAdministrationModule {}
