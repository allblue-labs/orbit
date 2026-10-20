import { Module } from '@nestjs/common';
import { CustomerPortalModule } from '../customer-portal/customer-portal.module';
import { OperationsModule } from '../operations/operations.module';
import {
  CustomerServiceRequestInternalController,
  CustomerServiceRequestPortalController,
} from './customer-service-request.controller';
import { CustomerServiceRequestMapper } from './customer-service-request.mapper';
import { CustomerServiceRequestPolicy } from './customer-service-request.policy';
import { CustomerServiceRequestRepository } from './customer-service-request.repository';
import { CustomerServiceRequestService } from './customer-service-request.service';

@Module({
  imports: [CustomerPortalModule, OperationsModule],
  controllers: [
    CustomerServiceRequestPortalController,
    CustomerServiceRequestInternalController,
  ],
  providers: [
    CustomerServiceRequestPolicy,
    CustomerServiceRequestMapper,
    CustomerServiceRequestRepository,
    CustomerServiceRequestService,
  ],
  exports: [CustomerServiceRequestService],
})
export class CustomerServiceRequestModule {}
