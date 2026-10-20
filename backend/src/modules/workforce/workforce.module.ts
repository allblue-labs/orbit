import { Module } from '@nestjs/common';
import { WorkforceController } from './workforce.controller';
import { WorkforceMapper } from './workforce.mapper';
import { WorkforceRepository } from './workforce.repository';
import { WorkforceService } from './workforce.service';
import { ProfessionalSignatoryPolicy } from './professional-signatory.policy';

@Module({
  controllers: [WorkforceController],
  providers: [
    WorkforceService,
    WorkforceRepository,
    WorkforceMapper,
    ProfessionalSignatoryPolicy,
  ],
  exports: [WorkforceService, WorkforceRepository, ProfessionalSignatoryPolicy],
})
export class WorkforceModule {}
