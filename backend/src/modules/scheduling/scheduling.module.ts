import { Module } from '@nestjs/common';
import { RecurrenceEngine } from './recurrence.engine';
import { SchedulingController } from './scheduling.controller';
import { SchedulingRepository } from './scheduling.repository';
import { SchedulingService } from './scheduling.service';
import {
  SCHEDULING_EVENT_PUBLISHER,
  SchedulingEventPublisherAdapter,
} from './scheduling.publisher';
import { OperationsModule } from '../operations/operations.module';
import { WorkforceModule } from '../workforce/workforce.module';

@Module({
  imports: [OperationsModule, WorkforceModule],
  controllers: [SchedulingController],
  providers: [
    SchedulingRepository,
    SchedulingService,
    RecurrenceEngine,
    SchedulingEventPublisherAdapter,
    {
      provide: SCHEDULING_EVENT_PUBLISHER,
      useExisting: SchedulingEventPublisherAdapter,
    },
  ],
  exports: [SchedulingService, SCHEDULING_EVENT_PUBLISHER],
})
export class SchedulingModule {}
