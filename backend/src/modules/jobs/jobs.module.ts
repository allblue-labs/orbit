/**
 * Infraestrutura de jobs.
 *
 * Global porque a fila é transversal: qualquer módulo que precise de trabalho
 * assíncrono injeta `BackgroundJobQueue`. Os processadores são registrados por
 * quem os implementa, em `JobProcessorRegistry` — que também é global, porque
 * as filas nascem em módulos que o worker não conhece.
 */
import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { RequestContextModule } from '../../context';
import { BackgroundJobQueue } from './background-job.queue';
import { AdminJobsController } from './admin-jobs.controller';
import { AdminJobsService } from './admin-jobs.service';
import { JobProcessorRegistry } from './job-processor.registry';

@Global()
@Module({
  imports: [PrismaModule, RequestContextModule],
  controllers: [AdminJobsController],
  providers: [BackgroundJobQueue, JobProcessorRegistry, AdminJobsService],
  exports: [BackgroundJobQueue, JobProcessorRegistry],
})
export class JobsModule {}
