import { Module } from '@nestjs/common';
import { FinancialModule } from '../financial/financial.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [FinancialModule, InventoryModule, SubscriptionPlansModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
