import { describe, expect, it } from 'vitest';

import { PairingCodeError, PairingCodeService } from '../auth/pairing-code-service.js';

function createService(now: () => number): PairingCodeService {
  return new PairingCodeService({
    expiresInSeconds: 300,
    maxFailures: 2,
    failureWindowSeconds: 300,
    now,
    generateCode: () => '042913',
  });
}

describe('PairingCodeService', () => {
  it('issues a six digit code and consumes it exactly once', () => {
    const service = createService(() => 1_000);

    expect(service.issue()).toEqual({
      code: '042913',
      expiresAt: new Date(301_000),
    });
    expect(service.isAvailable()).toBe(true);

    service.exchange('client-a', '042913', () => undefined);
    expect(service.isAvailable()).toBe(false);
    expect(() => service.exchange('client-a', '042913', () => undefined)).toThrowError(
      new PairingCodeError('PAIRING_CODE_EXPIRED'),
    );
  });

  it('expires after five minutes', () => {
    let now = 1_000;
    const service = createService(() => now);
    service.issue();
    now = 301_000;

    expect(() => service.exchange('client-a', '042913', () => undefined)).toThrowError(
      new PairingCodeError('PAIRING_CODE_EXPIRED'),
    );
  });

  it('rate limits repeated failures per client', () => {
    const service = createService(() => 1_000);
    service.issue();

    expect(() => service.exchange('client-a', '000000', () => undefined)).toThrowError(
      new PairingCodeError('PAIRING_CODE_INVALID'),
    );
    expect(() => service.exchange('client-a', '000001', () => undefined)).toThrowError(
      new PairingCodeError('PAIRING_CODE_INVALID'),
    );
    expect(() => service.exchange('client-a', '042913', () => undefined)).toThrowError(
      new PairingCodeError('PAIRING_RATE_LIMITED'),
    );
    expect(() => service.exchange('client-b', '042913', () => undefined)).toThrowError(
      new PairingCodeError('PAIRING_CODE_EXPIRED'),
    );
  });

  it('keeps a valid code available when the paired-device write fails', () => {
    const service = createService(() => 1_000);
    service.issue();

    expect(() =>
      service.exchange('client-a', '042913', () => {
        throw new Error('database unavailable');
      }),
    ).toThrow('database unavailable');
    expect(service.isAvailable()).toBe(true);
    expect(service.exchange('client-a', '042913', () => 'paired')).toBe('paired');
  });
});
