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
