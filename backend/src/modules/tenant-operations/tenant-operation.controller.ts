import { Controller, Get } from '@nestjs/common';
import { Surfaces } from '../../decorators';
import { RlsTransaction } from '../../database';
import { RequestContextService } from '../../context';
import {
  OPERATIONAL_DECISION,
  TenantRecovery,
  TenantOperationPolicy,
} from './tenant-operation.policy';
@Controller('organizations/current/operational-access')
@Surfaces('WEB', 'MOBILE', 'API')
export class TenantOperationController {
  constructor(
    private readonly policy: TenantOperationPolicy,
    private readonly rls: RlsTransaction,
    private readonly contexts: RequestContextService,
  ) {}
  @Get()
  @TenantRecovery('context')
  async current() {
    const state = await this.policy.snapshot();
    const organizationId = this.contexts.get().organizationId!;
    const latest = await this.rls.run((tx) =>
      tx.auditLog.findFirst({
        where: {
          organizationId,
          action: OPERATIONAL_DECISION,
          metadata: { path: ['result'], equals: 'APPLIED' },
        },
        orderBy: { createdAt: 'desc' },
        select: { after: true, createdAt: true },
      }),
    );
    const decision = latest?.after as {
      reason?: string;
      status?: string;
    } | null;
    const applied = decision?.status === state.status;
    return {
      ...state,
      reason: applied ? (decision?.reason ?? null) : null,
      decidedAt: applied ? (latest?.createdAt.toISOString() ?? null) : null,
      financialEligibilityIndependent: true,
    };
  }
}
