import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './database';
import { HotpathRedis } from './common/hotpath/hotpath-redis';

export interface HealthReadModel {
  status: 'ok' | 'degraded';
  checks?: {
    postgres: 'ok';
    jobs: 'ok';
    redis: 'ok' | 'disabled' | 'degraded';
  };
}

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: HotpathRedis,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  liveness(): HealthReadModel {
    return { status: 'ok' };
  }

  async readiness(): Promise<HealthReadModel> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '500ms'`;
          await tx.$queryRaw`SELECT 1 FROM public.background_jobs
          WHERE id = '00000000-0000-0000-0000-000000000000'::uuid`;
        },
        { maxWait: 750, timeout: 1_750 },
      );
      const redis = this.redis.readiness;
      return {
        status: redis === 'degraded' ? 'degraded' : 'ok',
        checks: { postgres: 'ok', jobs: 'ok', redis },
      };
    } catch {
      // Never include connection strings or driver errors in a public probe.
      throw new ServiceUnavailableException('Service is not ready');
    }
  }
}
