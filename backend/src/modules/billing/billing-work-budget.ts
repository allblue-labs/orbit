import { AsyncLocalStorage } from 'node:async_hooks';

/** Per background tick: checked before every SDK call (including nested reads). */
export class BillingWorkBudget {
  private static readonly context = new AsyncLocalStorage<{
    left: number;
    until: number;
  }>();
  static run<T>(
    calls: number,
    durationMs: number,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.context.run(
      { left: calls, until: Date.now() + durationMs },
      work,
    );
  }
  static active(): boolean {
    return !!this.context.getStore();
  }
  static consume(): void {
    const budget = this.context.getStore();
    if (budget && (Date.now() >= budget.until || budget.left-- <= 0))
      throw new Error('BILLING_WORK_BUDGET_EXHAUSTED');
  }
}
