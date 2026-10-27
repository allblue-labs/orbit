import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

@Module({
  imports: [InventoryModule, SubscriptionPlansModule],
  controllers: [CatalogController],
  providers: [CatalogRepository, CatalogService],
  exports: [CatalogService],
})
export class TechnicalCatalogsModule {}
