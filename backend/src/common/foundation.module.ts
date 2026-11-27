import {
  Global,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestContextModule } from '../context';
import {
  RequestContextInterceptor,
  ResponseInterceptor,
} from '../interceptors';
import { CommonProvidersModule } from '../providers';
import { IsJsonObjectConstraint } from '../validators';
import { FoundationExceptionFilter } from './foundation-exception.filter';
import { RequestIdMiddleware } from './request-id.middleware';
import { SensitiveEndpointRateLimitMiddleware } from './sensitive-endpoint-rate-limit.middleware';
import { AuthorizationService } from './authorization.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { PrismaModule } from '../database';
import { HotpathRedis } from './hotpath/hotpath-redis';
import { HotpathRateLimit } from './hotpath/hotpath-rate-limit';
import { HotpathSnapshot } from './hotpath/hotpath-snapshot';
import { IdempotencyInterceptor } from './hotpath/idempotency.interceptor';
import { IdempotencyCleanup } from './hotpath/idempotency-cleanup';
import { AuthChallengeCleanup } from './biometrics/auth-challenge-cleanup';
import { AuthChallengeStore } from './biometrics/auth-challenge.store';
import { SecurityConfirmation } from './biometrics/security-confirmation';

@Global()
@Module({
  imports: [RequestContextModule, CommonProvidersModule, PrismaModule],
  providers: [
    AuthorizationService,
    HotpathRedis,
    HotpathRateLimit,
    HotpathSnapshot,
    IdempotencyCleanup,
    AuthChallengeCleanup,
    AuthChallengeStore,
    SecurityConfirmation,
    AuthRateLimitService,
    IsJsonObjectConstraint,
    RequestIdMiddleware,
    SensitiveEndpointRateLimitMiddleware,
    { provide: APP_FILTER, useClass: FoundationExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [
    RequestContextModule,
    CommonProvidersModule,
    AuthorizationService,
    AuthRateLimitService,
    HotpathRedis,
    HotpathRateLimit,
    HotpathSnapshot,
    SecurityConfirmation,
  ],
})
export class FoundationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, SensitiveEndpointRateLimitMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
