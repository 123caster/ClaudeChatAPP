import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

export type PairingFailureCode =
  'PAIRING_CODE_INVALID' | 'PAIRING_CODE_EXPIRED' | 'PAIRING_RATE_LIMITED';

export class PairingCodeError extends Error {
  public constructor(public readonly code: PairingFailureCode) {
    super(code);
    this.name = 'PairingCodeError';
  }
}

type PairingCodeState = {
  digest: Buffer;
  expiresAt: number;
  failures: number;
};

export type PairingCodeOptions = {
  expiresInSeconds: number;
  maxFailures: number;
  failureWindowSeconds: number;
  now?: () => number;
  generateCode?: () => string;
};

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export class PairingCodeService {
  private current: PairingCodeState | null = null;
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly generateCode: () => string;

  public constructor(private readonly options: PairingCodeOptions) {
    this.now = options.now ?? Date.now;
    this.generateCode =
      options.generateCode ?? (() => randomInt(0, 1_000_000).toString().padStart(6, '0'));
  }

  public issue(): { code: string; expiresAt: Date } {
    const code = this.generateCode();
    if (!/^\d{6}$/.test(code)) {
      throw new Error('Generated pairing code must contain exactly six digits.');
    }

    const expiresAt = this.now() + this.options.expiresInSeconds * 1_000;
    this.current = { digest: digest(code), expiresAt, failures: 0 };
    this.failures.clear();
    return { code, expiresAt: new Date(expiresAt) };
  }

  public isAvailable(): boolean {
    return this.current !== null && this.current.expiresAt > this.now();
  }

  public exchange<T>(clientKey: string, code: string, operation: () => T): T {
    this.assertNotRateLimited(clientKey);

    const current = this.current;
    if (!current || current.expiresAt <= this.now()) {
      this.current = null;
      throw new PairingCodeError('PAIRING_CODE_EXPIRED');
    }

    const supplied = digest(code);
    if (!timingSafeEqual(current.digest, supplied)) {
      current.failures += 1;
      this.recordFailure(clientKey);
      if (current.failures >= this.options.maxFailures) {
        this.current = null;
      }
      throw new PairingCodeError('PAIRING_CODE_INVALID');
    }

    const result = operation();
    if (this.current === current) {
      this.current = null;
      this.failures.clear();
    }
    return result;
  }

  private assertNotRateLimited(clientKey: string): void {
    const failures = this.recentFailures(clientKey);
    if (failures.length >= this.options.maxFailures) {
      throw new PairingCodeError('PAIRING_RATE_LIMITED');
    }
  }

  private recordFailure(clientKey: string): void {
    const failures = this.recentFailures(clientKey);
    failures.push(this.now());
    this.failures.set(clientKey, failures);
  }

  private recentFailures(clientKey: string): number[] {
    const cutoff = this.now() - this.options.failureWindowSeconds * 1_000;
    const failures = (this.failures.get(clientKey) ?? []).filter((time) => time > cutoff);
    this.failures.set(clientKey, failures);
    return failures;
  }
}
