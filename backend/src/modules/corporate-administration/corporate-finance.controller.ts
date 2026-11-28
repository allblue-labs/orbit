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
  FinanceInvoiceListDto,
  FinanceDetailDto,
  FinancePaymentListDto,
  FinancePeriodDto,
} from './corporate-finance.dto';
import { CorporateFinanceService } from './corporate-finance.service';
import { corporateValidation } from './corporate-request';
import {
  FINANCE_INVOICES_READ,
  FINANCE_ORGANIZATIONS_READ,
  FINANCE_OVERVIEW_READ,
  FINANCE_PAYMENTS_READ,
} from './technical-credential.service';

@Public()
@UseGuards(TechnicalAuthenticationGuard, CorporateCapabilityGuard)
@Controller({ path: 'corporate-admin', version: '1' })
export class CorporateFinanceController {
  constructor(private readonly finance: CorporateFinanceService) {}

  @Get('finance/overview')
  @RequiresCorporateCapability(FINANCE_OVERVIEW_READ)
  overview(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: FinancePeriodDto,
  ) {
    return this.finance.overview(call, reference, query);
  }

  @Get('finance/invoices')
  @RequiresCorporateCapability(FINANCE_INVOICES_READ)
  invoices(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: FinanceInvoiceListDto,
  ) {
    return this.finance.invoices(call, reference, query);
  }

  @Get('finance/invoices/:id')
  @RequiresCorporateCapability(FINANCE_INVOICES_READ)
  invoice(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(corporateValidation) query: FinanceDetailDto,
  ) {
    return this.finance.invoice(call, reference, query, id);
  }

  @Get('finance/payments')
  @RequiresCorporateCapability(FINANCE_PAYMENTS_READ)
  payments(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Query(corporateValidation) query: FinancePaymentListDto,
  ) {
    return this.finance.payments(call, reference, query);
  }

  @Get('finance/payments/:id')
  @RequiresCorporateCapability(FINANCE_PAYMENTS_READ)
  payment(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id') id: string,
    @Query(corporateValidation) query: FinanceDetailDto,
  ) {
    return this.finance.payment(call, reference, query, id);
  }

  @Get('organizations/:id/finance')
  @RequiresCorporateCapability(FINANCE_ORGANIZATIONS_READ)
  organization(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(corporateValidation) query: FinancePeriodDto,
  ) {
    return this.finance.overview(call, reference, query, id);
  }

  @Get('organizations/:id/finance/invoices')
  @RequiresCorporateCapability([
    FINANCE_ORGANIZATIONS_READ,
    FINANCE_INVOICES_READ,
  ])
  organizationInvoices(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(corporateValidation) query: FinanceInvoiceListDto,
  ) {
    return this.finance.invoices(call, reference, query, id);
  }

  @Get('organizations/:id/finance/payments')
  @RequiresCorporateCapability([
    FINANCE_ORGANIZATIONS_READ,
    FINANCE_PAYMENTS_READ,
  ])
  organizationPayments(
    @CorporateCaller() call: CorporateCall,
    @Headers('x-nexus-administrator-id') reference: unknown,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(corporateValidation) query: FinancePaymentListDto,
  ) {
    return this.finance.payments(call, reference, query, id);
  }
}
