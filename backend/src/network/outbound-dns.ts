import { Injectable } from '@nestjs/common';
import { Resolver } from 'node:dns/promises';
export interface OutboundAddress {
  address: string;
  family: 4 | 6;
}

@Injectable()
export class OutboundDns {
  private active = 0;
  async resolve(
    hostname: string,
    timeoutMs = 5000,
  ): Promise<OutboundAddress[]> {
    if (this.active >= 32) throw new Error('Outbound DNS capacity reached');
    this.active++;
    // A resolver per operation is cancellable; no process-global DNS changes.
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    const timer = setTimeout(() => resolver.cancel(), timeoutMs);
    timer.unref();
    const absent = (error: unknown): string[] => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENODATA' || code === 'ENOTFOUND') return [];
      throw error;
    };
    try {
      const [v4, v6] = await Promise.all([
        resolver.resolve4(hostname).catch(absent),
        resolver.resolve6(hostname).catch(absent),
      ]);
      return [
        ...v4.map((address) => ({ address, family: 4 as const })),
        ...v6.map((address) => ({ address, family: 6 as const })),
      ];
    } finally {
      clearTimeout(timer);
      resolver.cancel();
      this.active--;
    }
  }
}
