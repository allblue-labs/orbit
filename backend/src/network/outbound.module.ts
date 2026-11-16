import { Module } from '@nestjs/common';
import {
  OUTBOUND_CONFIGURATION,
  outboundConfiguration,
} from './outbound.config';
import { OutboundDns } from './outbound-dns';
import { OutboundPolicy } from './outbound-policy';
import { OutboundHttp } from './outbound-http';
@Module({
  providers: [
    {
      provide: OUTBOUND_CONFIGURATION,
      useFactory: () => outboundConfiguration(),
    },
    OutboundDns,
    OutboundPolicy,
    OutboundHttp,
  ],
  exports: [OutboundPolicy, OutboundHttp],
})
export class OutboundModule {}
