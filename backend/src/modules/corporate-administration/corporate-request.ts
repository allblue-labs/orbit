import {
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { CorporateCall } from './corporate-access.guard';
import {
  TechnicalCredentialService,
  type CorporateCapability,
} from './technical-credential.service';

export const corporateValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
});

export function auditReference(
  call: CorporateCall,
  reference: unknown,
  required = false,
) {
  if (
    (required || reference !== undefined) &&
    (typeof reference !== 'string' || !isUUID(reference))
  ) {
    throw new BadRequestException('Invalid X-Nexus-Administrator-Id');
  }
  return {
    technicalPrincipalId: call.principal.id,
    declaredNexusAdministratorId:
      typeof reference === 'string' ? reference : undefined,
    correlationId: call.correlationId,
  };
}

export function authorizedCorporateReference(
  call: CorporateCall,
  reference: unknown,
  capability: CorporateCapability,
  write: boolean,
) {
  if (
    !TechnicalCredentialService.isAuthenticated(call.principal) ||
    !call.principal.capabilities.includes(capability)
  )
    throw new ForbiddenException();
  return auditReference(call, reference, write);
}
