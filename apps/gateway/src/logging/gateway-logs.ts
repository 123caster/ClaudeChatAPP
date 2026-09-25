import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const RETENTION_MS = 3 * 24 * 60 * 60 * 1_000;
const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1_000;

export function gatewayLoggerOptions(logDirectory: string) {
  const activeLogName = gatewayLogName();
  mkdirSync(logDirectory, { recursive: true });
  cleanupGatewayLogs(logDirectory, Date.now(), activeLogName);
  return {
    level: 'info',
    redact: {
      censor: '[REDACTED]',
      paths: [
        'req.headers.authorization',
        'req.headers.x-api-key',
        'authorization',
        'apiKey',
        'token',
        'ANTHROPIC_AUTH_TOKEN',
      ],
    },
    transport: {
      target: 'pino/file',
      options: {
        destination: path.join(logDirectory, activeLogName),
        mkdir: true,
      },
    },
  };
}

export function startGatewayLogRetention(logDirectory: string): () => void {
  const activeLogName = gatewayLogName();
  const timer = setInterval(
    () => cleanupGatewayLogs(logDirectory, Date.now(), activeLogName),
    CLEANUP_INTERVAL_MS,
  );
  timer.unref();
  return () => clearInterval(timer);
}

export function cleanupGatewayLogs(
  logDirectory: string,
  now = Date.now(),
  activeLogName: string | null = null,
): string[] {
  mkdirSync(logDirectory, { recursive: true });
  const removed: string[] = [];
  for (const entry of readdirSync(logDirectory)) {
    if (entry === activeLogName) continue;
    if (!/^gateway-\d{4}-\d{2}-\d{2}\.log$/.test(entry)) continue;
    const candidate = path.join(logDirectory, entry);
    try {
      if (now - statSync(candidate).mtimeMs > RETENTION_MS) {
        unlinkSync(candidate);
        removed.push(candidate);
      }
    } catch {
      // A concurrent log rotation or operator action may remove a file first.
    }
  }
  return removed;
}

function gatewayLogName(date = new Date()): string {
  return `gateway-${date.toISOString().slice(0, 10)}.log`;
}
