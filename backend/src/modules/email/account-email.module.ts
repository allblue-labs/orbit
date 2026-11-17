import { Module } from '@nestjs/common';
import { EmailModule } from './email.module';
import { IdentityEmailOutbox } from '../identity/infrastructure/identity-email.outbox';
import { AccountNoticesService } from './account-notices.service';
import { AccountNoticesWorker } from './account-notices.worker';
import { EntitlementRepository } from '../subscription-plans/entitlements/entitlement.repository';
/** Business delivery policy stays separate from the reusable SES transport. */
@Module({
  imports: [EmailModule],
  providers: [
    IdentityEmailOutbox,
    AccountNoticesService,
    AccountNoticesWorker,
    EntitlementRepository,
  ],
  exports: [EmailModule, IdentityEmailOutbox, AccountNoticesService],
})
export class AccountEmailModule {}
