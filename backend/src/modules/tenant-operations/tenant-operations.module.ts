import { Global, Module } from '@nestjs/common';
import { TenantOperationPolicy } from './tenant-operation.policy';
import { TenantOperationAdminService } from './tenant-operation-admin.service';
import { TenantOperationController } from './tenant-operation.controller';
@Global()
@Module({
  providers: [TenantOperationPolicy, TenantOperationAdminService],
  controllers: [TenantOperationController],
  exports: [TenantOperationPolicy, TenantOperationAdminService],
})
export class TenantOperationsModule {}
