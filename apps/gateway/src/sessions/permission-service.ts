import { randomUUID } from 'node:crypto';

import type { PermissionRecord, PermissionRepository } from '@claude-chat/database';
import type { PermissionDecision, PermissionRequest } from '@claude-chat/protocol';

import type {
  ClaudePermissionDecision,
  ClaudePermissionRequest,
} from '../claude/claude-adapter.js';
import type { EventStore } from '../events/event-store.js';
import { serializePermission } from './serializers.js';

type PendingPermission = {
  sessionId: string;
  resolve: (decision: ClaudePermissionDecision) => void;
  timer: NodeJS.Timeout;
};

export class PermissionNotResolvableError extends Error {
  public constructor(public readonly reason: 'not_found' | 'already_resolved' | 'expired') {
    super(`Permission request is not resolvable: ${reason}.`);
    this.name = 'PermissionNotResolvableError';
  }
}

export class PermissionService {
  private readonly pending = new Map<string, PendingPermission>();

  public constructor(
    private readonly permissions: PermissionRepository,
    private readonly events: EventStore,
    private readonly now: () => Date = () => new Date(),
    private readonly timeoutMs = 10 * 60 * 1_000,
  ) {}

  public request(
    sessionId: string,
    requestId: string | null,
    request: ClaudePermissionRequest,
  ): { permission: PermissionRequest; decision: Promise<ClaudePermissionDecision> } {
    const createdAt = this.now();
    const record = this.permissions.create({
      id: randomUUID(),
      sessionId,
      toolCallId: request.toolCallId,
      requestJson: JSON.stringify(request),
      decision: null,
      decisionMessage: null,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + this.timeoutMs).toISOString(),
      resolvedAt: null,
    });
    const permission = serializePermission(record);
    this.events.persist({
      sessionId,
      requestId,
      type: 'permission.requested',
      payload: { permission },
    });

    const decision = new Promise<ClaudePermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.expireRecord(record.id, 'Permission request timed out.');
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(record.id, { sessionId, resolve, timer });
    });

    return { permission, decision };
  }

  public decideRecord(permissionId: string, decision: PermissionDecision): PermissionRequest {
    const result = this.permissions.decide(permissionId, decision, null, this.now().toISOString());
    if (result.status !== 'decided') {
      throw new PermissionNotResolvableError(result.status);
    }
    return serializePermission(result.permission);
  }

  public completeDecision(permission: PermissionRequest): void {
    const pending = this.pending.get(permission.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(permission.id);
      pending.resolve({
        decision: permission.decision ?? 'deny',
        ...(permission.decisionMessage ? { message: permission.decisionMessage } : {}),
      });
    }
  }

  public cancelSession(sessionId: string, message: string): void {
    for (const [permissionId, pending] of this.pending) {
      if (pending.sessionId === sessionId) {
        this.resolveRecord(permissionId, 'deny', message);
      }
    }
  }

  private resolveRecord(
    permissionId: string,
    decision: PermissionDecision,
    message: string | null,
    requestId: string | null = null,
  ): PermissionRecord {
    const result = this.permissions.decide(
      permissionId,
      decision,
      message,
      this.now().toISOString(),
    );
    if (result.status !== 'decided') {
      throw new PermissionNotResolvableError(result.status);
    }

    const pending = this.pending.get(permissionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(permissionId);
      pending.resolve({ decision, ...(message ? { message } : {}) });
    }

    this.events.persist({
      sessionId: result.permission.sessionId,
      requestId,
      type: 'permission.resolved',
      payload: { permission: serializePermission(result.permission) },
    });
    return result.permission;
  }

  private expireRecord(permissionId: string, message: string): void {
    const result = this.permissions.expire(permissionId, message, this.now().toISOString());
    if (result.status !== 'decided') {
      return;
    }
    const pending = this.pending.get(permissionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(permissionId);
      pending.resolve({ decision: 'deny', message });
    }
    this.events.persist({
      sessionId: result.permission.sessionId,
      requestId: null,
      type: 'permission.resolved',
      payload: { permission: serializePermission(result.permission) },
    });
  }
}
