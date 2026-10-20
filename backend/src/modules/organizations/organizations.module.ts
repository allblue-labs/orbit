import { Module } from '@nestjs/common';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { IdentityModule } from '../identity/identity.module';
import { PmocModule } from '../pmoc/pmoc.module';
import { BusinessUnitController } from './business-units/business-unit.controller';
import { BusinessUnitRepository } from './business-units/business-unit.repository';
import { BusinessUnitService } from './business-units/business-unit.service';
import { CustomerController } from './business-units/customers/customer.controller';
import { CustomerRepository } from './business-units/customers/customer.repository';
import { CustomerReadModelMapper } from './business-units/customers/customer.mapper';
import { CustomerService } from './business-units/customers/customer.service';
import { AssetController } from './business-units/equipaments/asset.controller';
import { AssetRepository } from './business-units/equipaments/asset.repository';
import { AssetService } from './business-units/equipaments/asset.service';
import { EquipmentQrRenderer } from './business-units/equipaments/equipment-qr.renderer';
import { EquipmentQrRepository } from './business-units/equipaments/equipment-qr.repository';
import { EquipmentQrService } from './business-units/equipaments/equipment-qr.service';
import { OrganizationController } from './organization.controller';
import { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';
import { OrganizationReadModelMapper } from './organization.mapper';
import { TeamController } from './team/team.controller';
import { TeamRepository } from './team/team.repository';
import { TeamService } from './team/team.service';

@Module({
  imports: [SubscriptionPlansModule, PmocModule, IdentityModule],
  controllers: [
    OrganizationController,
    TeamController,
    BusinessUnitController,
    AssetController,
    CustomerController,
  ],
  providers: [
    OrganizationRepository,
    OrganizationService,
    TeamRepository,
    TeamService,
    OrganizationReadModelMapper,
    BusinessUnitRepository,
    BusinessUnitService,
    AssetRepository,
    AssetService,
    EquipmentQrRepository,
    EquipmentQrRenderer,
    EquipmentQrService,
    CustomerRepository,
    CustomerService,
    CustomerReadModelMapper,
  ],
  exports: [
    OrganizationService,
    BusinessUnitService,
    AssetService,
    EquipmentQrService,
    CustomerService,
  ],
})
export class OrganizationsModule {}
