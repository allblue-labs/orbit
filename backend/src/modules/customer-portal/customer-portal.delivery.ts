import { Injectable } from '@nestjs/common';
import type {
  CustomerPortalTokenDelivery,
  CustomerPortalTokenPurpose,
} from './customer-portal.types';

/** Safe boundary: no token is logged or returned while email is not connected. */
@Injectable()
export class NoopCustomerPortalTokenDelivery implements CustomerPortalTokenDelivery {
  deliver(
    purpose: CustomerPortalTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<void> {
    void purpose;
    void recipient;
    void token;
    return Promise.resolve();
  }
}
