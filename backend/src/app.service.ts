import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './database';

export interface HealthReadModel {
  status: 'ok';
}

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  liveness(): HealthReadModel {
    return { status: 'ok' };
  }

  async readiness(): Promise<HealthReadModel> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      // Never include connection strings or driver errors in a public probe.
      throw new ServiceUnavailableException('Service is not ready');
    }
  }
}
