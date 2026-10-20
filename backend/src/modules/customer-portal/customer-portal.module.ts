import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import {
  CustomerPortalAuthController,
  CustomerPortalController,
} from './customer-portal.controller';
import { NoopCustomerPortalTokenDelivery } from './customer-portal.delivery';
import { CustomerPortalGuard } from './customer-portal.guard';
import { CustomerPortalManagementController } from './customer-portal-management.controller';
import { CustomerPortalMapper } from './customer-portal.mapper';
import { CustomerPortalMetrics } from './customer-portal.metrics';
import { CustomerPortalAuthorizationPolicy } from './customer-portal.policy';
import { CustomerPortalRepository } from './customer-portal.repository';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalTokenService } from './customer-portal-token.service';
import { CUSTOMER_PORTAL_TOKEN_DELIVERY } from './customer-portal.types';
import { CustomerPortalReadController } from './customer-portal-read.controller';
import { CustomerPortalReadMapper } from './customer-portal-read.mapper';
import { CustomerPortalReadRepository } from './customer-portal-read.repository';
import { CustomerPortalReadService } from './customer-portal-read.service';
import { InfrastructureException } from '../../exceptions';

/**
 * O backend do Portal está preservado e coberto por testes, mas a V1 não tem
 * UI pública nem delivery de e-mail qualificado. Em runtime real ele fica
 * ausente do roteamento e do OpenAPI. Tentar habilitá-lo antes de substituir o
 * adapter Noop falha na subida, em vez de expor um fluxo incompleto.
 */
export function customerPortalControllers(
  environment: NodeJS.ProcessEnv,
): Array<
  | typeof CustomerPortalAuthController
  | typeof CustomerPortalController
  | typeof CustomerPortalReadController
  | typeof CustomerPortalManagementController
> {
  if (environment.NODE_ENV === 'test') {
    return [
      CustomerPortalAuthController,
      CustomerPortalController,
      CustomerPortalReadController,
      CustomerPortalManagementController,
    ];
  }
  if ((environment.CUSTOMER_PORTAL_ENABLED ?? 'false') === 'true') {
    throw new InfrastructureException(
      'CUSTOMER_PORTAL_ENABLED cannot be enabled before UI and email delivery are release-qualified',
    );
  }
  return [];
}

@Module({
  imports: [JwtModule.register({})],
  controllers: customerPortalControllers(process.env),
  providers: [
    CustomerPortalRepository,
    CustomerPortalService,
    CustomerPortalTokenService,
    CustomerPortalGuard,
    CustomerPortalMapper,
    CustomerPortalMetrics,
    CustomerPortalAuthorizationPolicy,
    CustomerPortalReadMapper,
    CustomerPortalReadRepository,
    CustomerPortalReadService,
    NoopCustomerPortalTokenDelivery,
    {
      provide: CUSTOMER_PORTAL_TOKEN_DELIVERY,
      useExisting: NoopCustomerPortalTokenDelivery,
    },
  ],
  exports: [
    CustomerPortalGuard,
    CustomerPortalTokenService,
    CustomerPortalRepository,
    CustomerPortalService,
    CustomerPortalAuthorizationPolicy,
  ],
})
export class CustomerPortalModule {}
