import './configure-environment';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FoundationModule } from './common';
import { PrismaModule } from './database';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { TechnicalCatalogsModule } from './modules/technical-catalogs/technical-catalogs.module';
import { WorkforceModule } from './modules/workforce/workforce.module';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { FinancialModule } from './modules/financial/financial.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { ManagementReportsModule } from './modules/management-reports/management-reports.module';
import { PmocModule } from './modules/pmoc/pmoc.module';
import { OperationsModule } from './modules/operations/operations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AiPanelModule } from './modules/ai-panel/ai-panel.module';
import { DashboardModule } from './modules/dashboards/dashboard.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { PlatformAdministrationModule } from './modules/platform-administration/platform-administration.module';
import { ArtifactTemplateModule } from './modules/artifact-templates/artifact-template.module';
import { ArtifactRenderingModule } from './modules/artifact-rendering/artifact-rendering.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ArtifactManifestModule } from './modules/artifact-manifests/artifact-manifest.module';
import { StorageModule } from './modules/storage/storage.module';
import { ArtifactExecutionModule } from './modules/artifact-executions/artifact-execution.module';
import { IssuedDocumentModule } from './modules/issued-documents/issued-document.module';
import { RvtModule } from './modules/rvt/rvt.module';
import { MobileFieldModule } from './modules/mobile-field/mobile-field.module';
import { CustomerPortalModule } from './modules/customer-portal/customer-portal.module';
import { CustomerServiceRequestModule } from './modules/customer-service-requests/customer-service-request.module';
import { BillingModule } from './modules/billing/billing.module';
import { PermissionGuard, RoleGuard, SurfaceGuard } from './guards';
import { JwtAuthenticationGuard } from './modules/identity/infrastructure/jwt-authentication.guard';
import {
  ActivePlanGuard,
  CapabilityGuard,
  RequiredPlanGuard,
} from './modules/subscription-plans/plan-access';
import {
  ProductCapabilityGuard,
  ProductFeatureGuard,
} from './modules/subscription-plans/product-access';

@Module({
  imports: [
    FoundationModule,
    PrismaModule,
    IdentityModule,
    OrganizationsModule,
    TechnicalCatalogsModule,
    WorkforceModule,
    CommissionsModule,
    FinancialModule,
    QuotesModule,
    InventoryModule,
    AutomationsModule,
    ManagementReportsModule,
    PmocModule,
    IntegrationsModule,
    OperationsModule,
    ReportsModule,
    SignaturesModule,
    NotificationsModule,
    AiPanelModule,
    DashboardModule,
    SchedulingModule,
    AnalyticsModule,
    PlatformAdministrationModule,
    ArtifactTemplateModule,
    ArtifactExecutionModule,
    IssuedDocumentModule,
    StorageModule,
    ArtifactManifestModule,
    JobsModule,
    ArtifactRenderingModule,
    RvtModule,
    MobileFieldModule,
    CustomerPortalModule,
    CustomerServiceRequestModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    /**
     * Pipeline global de segurança, deliberadamente centralizado e ordenado.
     *
     * Módulos de produto não registram `APP_GUARD`: a ordem de `imports`
     * deixa de ser uma autoridade acidental sobre autenticação/autorização.
     * Toda requisição privada autentica primeiro; só então RBAC e
     * entitlements podem consultar o contexto estabelecido pelo JWT.
     */
    { provide: APP_GUARD, useClass: JwtAuthenticationGuard },
    { provide: APP_GUARD, useClass: SurfaceGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_GUARD, useClass: RoleGuard },
    { provide: APP_GUARD, useClass: ActivePlanGuard },
    { provide: APP_GUARD, useClass: RequiredPlanGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },
    { provide: APP_GUARD, useClass: ProductCapabilityGuard },
    { provide: APP_GUARD, useClass: ProductFeatureGuard },
  ],
})
export class AppModule {}
