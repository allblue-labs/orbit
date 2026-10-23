import { Module } from '@nestjs/common';
import { LegalAcceptanceController } from './legal-acceptance.controller';
import { LegalController } from './legal.controller';
@Module({ controllers: [LegalController, LegalAcceptanceController] })
export class LegalModule {}
