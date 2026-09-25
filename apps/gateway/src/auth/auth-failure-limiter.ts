export type AuthFailureLimiterOptions = {
  maxFailures: number;
  failureWindowMs: number;
  now?: () => number;
};

export class AuthFailureLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;

  public constructor(private readonly options: AuthFailureLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  public isBlocked(clientKey: string): boolean {
    return this.recentFailures(clientKey).length >= this.options.maxFailures;
  }

  public recordFailure(clientKey: string): void {
    const failures = this.recentFailures(clientKey);
    failures.push(this.now());
    this.failures.set(clientKey, failures);
  }

  public clear(clientKey: string): void {
    this.failures.delete(clientKey);
  }

  private recentFailures(clientKey: string): number[] {
    const cutoff = this.now() - this.options.failureWindowMs;
    const failures = (this.failures.get(clientKey) ?? []).filter((time) => time > cutoff);
    if (failures.length === 0) this.failures.delete(clientKey);
    else this.failures.set(clientKey, failures);
    return failures;
  }
}
