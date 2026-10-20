import { Injectable } from '@nestjs/common';

export type PortalMetric =
  | 'login.attempt'
  | 'login.success'
  | 'login.failure'
  | 'invite.activation'
  | 'password.reset'
  | 'session.active';

@Injectable()
export class CustomerPortalMetrics {
  private readonly counters = new Map<PortalMetric, number>();

  increment(metric: PortalMetric): void {
    this.counters.set(metric, (this.counters.get(metric) ?? 0) + 1);
  }

  snapshot(): Readonly<Record<PortalMetric, number>> {
    return Object.freeze({
      'login.attempt': this.counters.get('login.attempt') ?? 0,
      'login.success': this.counters.get('login.success') ?? 0,
      'login.failure': this.counters.get('login.failure') ?? 0,
      'invite.activation': this.counters.get('invite.activation') ?? 0,
      'password.reset': this.counters.get('password.reset') ?? 0,
      'session.active': this.counters.get('session.active') ?? 0,
    });
  }
}
