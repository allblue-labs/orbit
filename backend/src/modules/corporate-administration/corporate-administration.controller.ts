import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from '../../decorators';
import {
  CorporateCaller,
  CorporateCapabilityGuard,
  type CorporateCall,
  RequiresCorporateCapability,
  TechnicalAuthenticationGuard,
} from './corporate-access.guard';
import { CAPABILITIES, CONNECTION_READ } from './technical-credential.service';

// Public bypasses the human JWT boundary. These routes always run both machine guards.
@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin', version: '1' })
export class CorporateAdministrationController {
  @Get('connection')
  @RequiresCorporateCapability(CONNECTION_READ)
  connection() {
    return { status: 'ok' as const };
  }

  @Get('version')
  @RequiresCorporateCapability(CONNECTION_READ)
  version() {
    return { service: 'orbit-corporate-admin', version: '1.0.0' };
  }

  @Get('capabilities')
  @RequiresCorporateCapability(CONNECTION_READ)
  capabilities() {
    return { capabilities: [CONNECTION_READ] };
  }
  @Get('capabilities/effective')
  @RequiresCorporateCapability(CONNECTION_READ)
  effectiveCapabilities(@CorporateCaller() call: CorporateCall) {
    return {
      contractCapabilities: [...CAPABILITIES].sort(),
      grantedCapabilities: [...call.principal.capabilities].sort(),
    };
  }
}
