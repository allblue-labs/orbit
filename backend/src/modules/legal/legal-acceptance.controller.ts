import { Controller, Get, Req } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
@Controller('legal')
export class LegalAcceptanceController {
  constructor(private readonly rls: RlsTransaction) {}
  @Get('acceptance')
  async current(@Req() request: IdentityRequest) {
    const organizationId = request.identity?.organizationId;
    const userId = request.identity?.id;
    if (!organizationId || !userId) return null;
    return this.rls.run((tx) =>
      tx.organizationLegalAcceptance.findFirst({
        where: { organizationId, userId },
        orderBy: { acceptedAt: 'desc' },
        select: { termsVersion: true, privacyVersion: true, acceptedAt: true },
      }),
    );
  }
}
