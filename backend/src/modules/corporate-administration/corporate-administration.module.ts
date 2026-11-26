import { Module } from '@nestjs/common';
import { CorporateAdministrationController } from './corporate-administration.controller';
import {
  CorporateCapabilityGuard,
  TechnicalAuthenticationGuard,
} from './corporate-access.guard';
import { TechnicalCredentialService } from './technical-credential.service';

@Module({
  controllers: [CorporateAdministrationController],
  providers: [
    TechnicalCredentialService,
    TechnicalAuthenticationGuard,
    CorporateCapabilityGuard,
  ],
})
export class CorporateAdministrationModule {}
