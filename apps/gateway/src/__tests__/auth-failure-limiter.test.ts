import { describe, expect, it } from 'vitest';

import { AuthFailureLimiter } from '../auth/auth-failure-limiter.js';

describe('AuthFailureLimiter', () => {
  it('blocks repeated failures, clears successful clients, and expires the window', () => {
    let now = 1_000;
    const limiter = new AuthFailureLimiter({
      maxFailures: 2,
      failureWindowMs: 5_000,
      now: () => now,
    });

    limiter.recordFailure('phone');
    expect(limiter.isBlocked('phone')).toBe(false);
    limiter.recordFailure('phone');
    expect(limiter.isBlocked('phone')).toBe(true);

    limiter.clear('phone');
    expect(limiter.isBlocked('phone')).toBe(false);

    limiter.recordFailure('phone');
    limiter.recordFailure('phone');
    now += 5_001;
    expect(limiter.isBlocked('phone')).toBe(false);
  });
});
