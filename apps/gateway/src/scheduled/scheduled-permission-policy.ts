import { existsSync, realpathSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';

import type { ClaudePermissionRequest } from '../claude/claude-adapter.js';
import { isPathContained } from '../projects/path-policy.js';

function requestedPath(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value =
    (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).path;
  return typeof value === 'string' && value.trim() ? value : null;
}

function nearestExistingPath(candidate: string): string | null {
  let current = candidate;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function isPrivateAddress(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  const version = isIP(host);
  if (version === 4) {
    const [first = 0, second = 0] = host.split('.').map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }
  if (version === 6) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.')
    );
  }
  return false;
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      Boolean(url.hostname) &&
      !isPrivateAddress(url.hostname)
    );
  } catch {
    return false;
  }
}

function isSafeReadOnlyCurl(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const command = (input as Record<string, unknown>).command;
  if (typeof command !== 'string' || command.includes('\n') || command.includes('\r')) return false;
  const match = command.match(
    /^curl\s+(?:-[sSf]{1,4}\s+)*"([^"$`\\]+)"(?:\s*\|\s*head\s+-c\s+([1-9]\d{0,6}))?$/,
  );
  if (!match?.[1] || !isPublicHttpsUrl(match[1])) return false;
  return !match[2] || Number(match[2]) <= 1_000_000;
}

function isSafeToolResultRead(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const command = (input as Record<string, unknown>).command;
  if (typeof command !== 'string' || command.includes('\n') || command.includes('\r')) return false;
  const match = command.match(
    /^grep\s+-oE\s+'[^'\r\n]{1,1000}'\s+(\/home\/ubuntu\/\.claude\/projects\/[A-Za-z0-9._/-]+\/tool-results\/[A-Za-z0-9._-]+\.txt)$/,
  );
  const filePath = match?.[1];
  return Boolean(filePath && !filePath.split('/').includes('..'));
}

export function canAutoApproveScheduledRead(request: ClaudePermissionRequest): boolean {
  if (request.toolName === 'WebSearch') return true;
  if (request.toolName === 'Bash') {
    return isSafeReadOnlyCurl(request.input) || isSafeToolResultRead(request.input);
  }
  if (request.toolName !== 'WebFetch' || !request.input || typeof request.input !== 'object') {
    return false;
  }
  const value = (request.input as Record<string, unknown>).url;
  if (typeof value !== 'string') return false;
  return isPublicHttpsUrl(value);
}

export function canAutoApproveScheduledWrite(
  request: ClaudePermissionRequest,
  cwd: string,
  allowAutoWrite: boolean,
): boolean {
  if (!allowAutoWrite || !['Write', 'Edit'].includes(request.toolName)) return false;
  const filePath = requestedPath(request.input);
  if (!filePath || filePath.includes('\0')) return false;

  try {
    const root = realpathSync.native(cwd);
    const candidate = path.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(root, filePath);
    if (!isPathContained(root, candidate)) return false;
    const existing = nearestExistingPath(candidate);
    if (!existing) return false;
    return isPathContained(root, realpathSync.native(existing));
  } catch {
    return false;
  }
}
