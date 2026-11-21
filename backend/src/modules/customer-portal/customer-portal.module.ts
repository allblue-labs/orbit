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
import { CustomerPortalProfileController } from './customer-portal-profile.controller';
import { CustomerPortalProfileService } from './customer-portal-profile.service';

/**
 * O backend do Portal está preservado e coberto por testes, mas a V1 não tem
 * UI pública nem delivery de e-mail qualificado. Em runtime real ele fica
 * ausente do roteamento e do OpenAPI. Tentar habilitá-lo antes de substituir o
 * adapter Noop falha na subida, em vez de expor um fluxo incompleto.
 */
const PORTAL_CONTROLLERS = [
  CustomerPortalAuthController,
  CustomerPortalController,
  CustomerPortalReadController,
  CustomerPortalProfileController,
  CustomerPortalManagementController,
];

/**
 * O portal só existe quando a instalação o liga.
 *
 * Desligado (o padrão), nenhuma rota é registrada: nem login, nem leitura, nem
 * a gestão do acesso. Ligado, tudo — inclusive convite e recuperação por
 * e-mail, que respondem "indisponível" enquanto não houver entrega de e-mail
 * real (`CustomerPortalTokenDelivery.connected`). O acesso que o owner cria
 * não depende de e-mail: a senha temporária é entregue por ele.
 */
export function customerPortalControllers(
  environment: NodeJS.ProcessEnv,
): typeof PORTAL_CONTROLLERS {
  if (environment.NODE_ENV === 'test') return PORTAL_CONTROLLERS;
  return (environment.CUSTOMER_PORTAL_ENABLED ?? 'false') === 'true'
    ? PORTAL_CONTROLLERS
    : [];
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
    CustomerPortalProfileService,
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
