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
  LoggingInterceptor,
  RequestContextInterceptor,
  RequestIdInterceptor,
  ResponseInterceptor,
} from '../interceptors';
import { CommonProvidersModule } from '../providers';
import { IsJsonObjectConstraint } from '../validators';
import { FoundationExceptionFilter } from './foundation-exception.filter';
import { RequestIdMiddleware } from './request-id.middleware';
import { SensitiveEndpointRateLimitMiddleware } from './sensitive-endpoint-rate-limit.middleware';
import { AuthorizationService } from './authorization.service';

@Global()
@Module({
  imports: [RequestContextModule, CommonProvidersModule],
  providers: [
    AuthorizationService,
    IsJsonObjectConstraint,
    RequestIdMiddleware,
    SensitiveEndpointRateLimitMiddleware,
    { provide: APP_FILTER, useClass: FoundationExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
  exports: [RequestContextModule, CommonProvidersModule, AuthorizationService],
})
export class FoundationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware, SensitiveEndpointRateLimitMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
