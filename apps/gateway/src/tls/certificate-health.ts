import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';

import type { HealthResponse } from '@claude-chat/protocol';

const EXPIRING_THRESHOLD_MS = 48 * 60 * 60 * 1_000;

export function readCertificateHealth(
  certificatePath: string | undefined,
  now = Date.now(),
): NonNullable<HealthResponse['certificate']> {
  if (!certificatePath) return { status: 'disabled' };

  try {
    const certificate = new X509Certificate(readFileSync(certificatePath));
    const expiresAt = new Date(certificate.validTo);
    const remainingMs = expiresAt.getTime() - now;
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      return { status: 'unavailable', message: 'HTTPS certificate is expired or invalid.' };
    }
    return {
      status: remainingMs <= EXPIRING_THRESHOLD_MS ? 'expiring' : 'ready',
      expiresAt: expiresAt.toISOString(),
    };
  } catch {
    return { status: 'unavailable', message: 'HTTPS certificate health check failed.' };
  }
}
