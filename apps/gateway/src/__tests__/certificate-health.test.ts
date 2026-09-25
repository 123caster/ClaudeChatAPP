import { describe, expect, it } from 'vitest';

import { readCertificateHealth } from '../tls/certificate-health.js';

describe('readCertificateHealth', () => {
  it('reports disabled without a configured certificate path', () => {
    expect(readCertificateHealth(undefined)).toEqual({ status: 'disabled' });
  });

  it('sanitizes unreadable certificate failures', () => {
    expect(readCertificateHealth('missing-certificate.pem')).toEqual({
      status: 'unavailable',
      message: 'HTTPS certificate health check failed.',
    });
  });
});
