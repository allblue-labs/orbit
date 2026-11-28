import {
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../decorators';
import {
  CorporateCaller,
  CorporateCapabilityGuard,
  RequiresCorporateCapability,
  TechnicalAuthenticationGuard,
  type CorporateCall,
} from './corporate-access.guard';
import {
  ProvisioningListDto,
  ReceiptHistoryDto,
  ReceiptLookupDto,
  SubscriptionListDto,
} from './corporate-completion.dto';
import { CorporateCompletionService } from './corporate-completion.service';
import { corporateValidation } from './corporate-request';
import {
  ORGANIZATIONS_PROVISIONING_READ,
  RECEIPTS_READ,
  SUBSCRIPTIONS_READ,
} from './technical-credential.service';

@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin', version: '1' })
export class CorporateCompletionController {
  constructor(private readonly reads: CorporateCompletionService) {}

  @Get('tenant-provisionings')
  @RequiresCorporateCapability(ORGANIZATIONS_PROVISIONING_READ)
  listProvisionings(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: ProvisioningListDto,
  ) {
    return this.reads.provisionings(call, reference, query);
  }

  @Get('subscriptions')
  @RequiresCorporateCapability(SUBSCRIPTIONS_READ)
  listSubscriptions(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: SubscriptionListDto,
  ) {
    return this.reads.subscriptions(call, reference, query);
  }

  @Get('organizations/:id/administrative-receipts')
  @RequiresCorporateCapability(RECEIPTS_READ)
  receiptHistory(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(corporateValidation) query: ReceiptHistoryDto,
  ) {
    return this.reads.history(call, reference, id, query);
  }

  @Get('administrative-receipts/lookup')
  @RequiresCorporateCapability(RECEIPTS_READ)
  lookupReceipt(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Headers('idempotency-key') key: unknown,
    @Query(corporateValidation) query: ReceiptLookupDto,
  ) {
    return this.reads.lookup(call, reference, query, key);
  }
}
