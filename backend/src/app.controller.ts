import { Controller, Get, Header } from '@nestjs/common';
import { AppService, type HealthReadModel } from './app.service';
import { Public } from './decorators';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('release')
  @Public()
  @Header('Cache-Control', 'no-store')
  release() {
    return {
      service: 'orbit-api',
      billingFlow: 'checkout-required-v2',
      commit: process.env.ORBIT_COMMIT_SHA ?? 'unknown',
      builtAt: process.env.ORBIT_BUILD_TIME ?? 'unknown',
    };
  }

  @Get('health/live')
  @Public()
  @Header('Cache-Control', 'no-store')
  liveness(): HealthReadModel {
    return this.appService.liveness();
  }

  @Get('health/ready')
  @Public()
  @Header('Cache-Control', 'no-store')
  readiness(): Promise<HealthReadModel> {
    return this.appService.readiness();
  }
}
