import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import { ValidationException } from '../exceptions';
import {
  isPrivateRouteAddress,
  isPublicOutboundAddress,
  sameAddress,
} from './outbound-address';
import {
  OUTBOUND_CONFIGURATION,
  type OutboundConfiguration,
  type OutboundPurpose,
} from './outbound.config';
import { OutboundDns, type OutboundAddress } from './outbound-dns';

export class OutboundDenied extends ValidationException {
  constructor(
    readonly reason:
      'URL_DENIED' | 'ORIGIN_DENIED' | 'DNS_DENIED' | 'DNS_UNAVAILABLE',
  ) {
    super(
      'O destino externo não é permitido ou não pôde ser validado. Consulte a configuração da integração.',
    );
  }
}
@Injectable()
export class OutboundPolicy {
  constructor(
    @Inject(OUTBOUND_CONFIGURATION)
    private readonly config: OutboundConfiguration,
    @Inject(OutboundDns) private readonly dns: Pick<OutboundDns, 'resolve'>,
  ) {
    if (config.privateAiRoutes.length)
      new Logger(OutboundPolicy.name).warn({
        stage: 'outbound-private-ai-routes-enabled',
        routes: config.privateAiRoutes.length,
        policyDigest: createHash('sha256')
          .update(JSON.stringify(config.privateAiRoutes))
          .digest('hex'),
      });
  }

  url(purpose: OutboundPurpose, value: string): URL {
    let url: URL;
    try {
      if (
        value.length > 4000 ||
        Array.from(value).some(
          (c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127 || c === '\\',
        )
      )
        throw new Error();
      url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        (purpose === 'AI' && url.search)
      )
        throw new Error();
    } catch {
      throw new OutboundDenied('URL_DENIED');
    }
    const privateRoute =
      purpose === 'AI' &&
      this.config.privateAiRoutes.some((r) => r.origin === url.origin);
    const origins =
      purpose === 'AI'
        ? this.config.aiOrigins
        : purpose === 'CACHE_PURGE'
          ? ['https://api.cloudflare.com']
          : this.config.pushOrigins;
    if (!privateRoute && !origins.includes(url.origin))
      throw new OutboundDenied('ORIGIN_DENIED');
    return url;
  }

  async authorize(
    purpose: OutboundPurpose,
    value: string,
    timeoutMs = 5000,
  ): Promise<{ url: URL; address: OutboundAddress }> {
    const url = this.url(purpose, value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    let addresses: OutboundAddress[];
    try {
      addresses = family
        ? [{ address: hostname, family: family as 4 | 6 }]
        : await this.dns.resolve(hostname, timeoutMs);
    } catch {
      throw new OutboundDenied('DNS_UNAVAILABLE');
    }
    const route =
      purpose === 'AI'
        ? this.config.privateAiRoutes.find((r) => r.origin === url.origin)
        : undefined;
    if (
      !addresses.length ||
      addresses.length > 64 ||
      addresses.some(
        ({ address, family: recordFamily }) =>
          isIP(address) !== recordFamily ||
          (route
            ? !isPrivateRouteAddress(address) ||
              !route.addresses.some((ip) => sameAddress(ip, address))
            : !isPublicOutboundAddress(address)),
      )
    )
      throw new OutboundDenied('DNS_DENIED');
    // All returned A/AAAA must pass; the transport connects to this exact IP.
    return { url, address: addresses[0]! };
  }
}
