import { createHash, randomUUID } from 'node:crypto';

import {
  IdempotencyConflictError,
  type DatabaseClient,
  type MessageRecord,
  type ProjectRecord,
  type SessionRecord,
} from '@claude-chat/database';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  EventEnvelope,
  PermissionDecisionRequest,
  PermissionDecisionResponse,
  SendMessageRequest,
  SendMessageResponse,
  SessionDetail,
  SessionSummary,
  WriteActionRequest,
} from '@claude-chat/protocol';

import type { ClaudeAdapter } from '../claude/claude-adapter.js';
import type { EventStore } from '../events/event-store.js';
import type { ProjectRegistry } from '../projects/project-registry.js';
import { assertSessionTransition } from './session-state-machine.js';
import { PermissionService } from './permission-service.js';
import {
  serializeMessage,
  serializeSessionDetail,
  serializeSessionSummary,
  serializeToolCall,
} from './serializers.js';

export class SessionNotFoundError extends Error {}
export class SessionConflictError extends Error {}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class SessionService {
  private readonly activeTurns = new Map<string, AbortController>();
  private readonly permissions: PermissionService;

  public constructor(
    private readonly database: DatabaseClient,
    private readonly projects: ProjectRegistry,
    private readonly adapter: ClaudeAdapter,
    private readonly events: EventStore,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.permissions = new PermissionService(database.permissions, events, now);
  }

  public recoverOnStartup(): { sessions: number; permissions: number } {
    const timestamp = this.now().toISOString();
    return {
      sessions: this.database.sessions.recoverInterrupted(timestamp),
      permissions: this.database.permissions.cancelUnresolved(
        timestamp,
        'Gateway restarted before the permission was resolved.',
      ),
    };
  }

  public list(): SessionSummary[] {
    return this.database.sessions.list().map((session) => this.summary(session));
  }

  public detail(sessionId: string): SessionDetail {
    const session = this.requireSession(sessionId);
    return this.serializeDetail(session);
  }

  public create(request: CreateSessionRequest): CreateSessionResponse {
    let cwdForStart: string | null = null;
    const committedEvents: EventEnvelope[] = [];
    const result = this.database.idempotency.execute<CreateSessionResponse>(
      {
        requestId: request.requestId,
        operation: 'session.create',
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        cwdForStart = this.projects.resolveForExecution(request.projectId);
        const timestamp = this.now().toISOString();
        const session = this.database.sessions.create({
          id: randomUUID(),
          claudeSessionId: null,
          projectId: request.projectId,
          title: request.title ?? request.message.slice(0, 80),
          status: 'running',
          createdAt: timestamp,
          updatedAt: timestamp,
          archivedAt: null,
        });
        const message = this.database.messages.create(
          this.userMessage(session.id, request.message, timestamp),
        );
        const response = { requestId: request.requestId, session: this.serializeDetail(session) };
        committedEvents.push(
          this.events.append({
            sessionId: session.id,
            requestId: request.requestId,
            type: 'session.created',
            payload: { session: this.summary(session) },
          }),
          this.events.append({
            sessionId: session.id,
            requestId: request.requestId,
            type: 'message.created',
            payload: { message: serializeMessage(message) },
          }),
        );
        return response;
      },
    );

    if (!result.replayed) {
      committedEvents.forEach((event) => this.events.publish(event));
      this.startTurn(result.value.session.id, request.requestId, request.message, cwdForStart!);
      return result.value;
    }

    const resumed = this.resumeTurnIfNeeded(
      result.value.session.id,
      request.requestId,
      request.message,
    );
    if (resumed) {
      return { requestId: request.requestId, session: this.serializeDetail(resumed) };
    }
    return result.value;
  }

  public sendMessage(sessionId: string, request: SendMessageRequest): SendMessageResponse {
    let cwdForStart: string | null = null;
    const committedEvents: EventEnvelope[] = [];
    const result = this.database.idempotency.execute<SendMessageResponse>(
      {
        requestId: request.requestId,
        operation: `session.message:${sessionId}`,
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const session = this.requireSession(sessionId);
        cwdForStart = this.projects.resolveForExecution(session.projectId);
        try {
          assertSessionTransition(session.status, 'running');
        } catch {
          throw new SessionConflictError('Session is not ready for a new message.');
        }
        const timestamp = this.now().toISOString();
        const message = this.database.messages.create(
          this.userMessage(sessionId, request.message, timestamp),
        );
        const updated = this.database.sessions.updateStatus(sessionId, 'running', timestamp)!;
        const response = {
          requestId: request.requestId,
          message: serializeMessage(message),
          session: this.summary(updated),
        };
        committedEvents.push(
          this.events.append({
            sessionId,
            requestId: request.requestId,
            type: 'message.created',
            payload: { message: response.message },
          }),
          this.events.append({
            sessionId,
            requestId: request.requestId,
            type: 'session.updated',
            payload: { session: response.session },
          }),
        );
        return response;
      },
    );

    if (!result.replayed) {
      committedEvents.forEach((event) => this.events.publish(event));
      this.startTurn(sessionId, request.requestId, request.message, cwdForStart!);
      return result.value;
    }

    const resumed = this.resumeTurnIfNeeded(sessionId, request.requestId, request.message);
    if (resumed) {
      return { ...result.value, session: this.summary(resumed) };
    }
    return result.value;
  }

  public cancel(sessionId: string, request: WriteActionRequest): SessionSummary {
    const result = this.database.idempotency.execute<SessionSummary>(
      {
        requestId: request.requestId,
        operation: `session.cancel:${sessionId}`,
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const session = this.requireSession(sessionId);
        if (session.status !== 'running' && session.status !== 'waiting_permission') {
          throw new SessionConflictError('Only an active turn can be cancelled.');
        }
        const updated = this.database.sessions.updateStatus(
          sessionId,
          'interrupted',
          this.now().toISOString(),
        )!;
        return this.summary(updated);
      },
    );
    if (!result.replayed) {
      this.activeTurns.get(sessionId)?.abort();
      this.permissions.cancelSession(sessionId, 'Turn cancelled by the user.');
      this.events.persist({
        sessionId,
        requestId: request.requestId,
        type: 'turn.failed',
        payload: {
          session: result.value,
          code: 'TURN_CANCELLED',
          message: 'Turn cancelled by the user.',
          retryable: true,
        },
      });
    }
    return result.value;
  }

  public archive(sessionId: string, request: WriteActionRequest): SessionSummary {
    const result = this.database.idempotency.execute<SessionSummary>(
      {
        requestId: request.requestId,
        operation: `session.archive:${sessionId}`,
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const session = this.requireSession(sessionId);
        try {
          assertSessionTransition(session.status, 'archived');
        } catch {
          throw new SessionConflictError('Active sessions cannot be archived.');
        }
        return this.summary(this.database.sessions.archive(sessionId, this.now().toISOString())!);
      },
    );
    if (!result.replayed) {
      this.events.persist({
        sessionId,
        requestId: request.requestId,
        type: 'session.updated',
        payload: { session: result.value },
      });
    }
    return result.value;
  }

  public decidePermission(
    permissionId: string,
    request: PermissionDecisionRequest,
  ): PermissionDecisionResponse {
    const committedEvents: EventEnvelope[] = [];
    const result = this.database.idempotency.execute<PermissionDecisionResponse>(
      {
        requestId: request.requestId,
        operation: `permission.decision:${permissionId}`,
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const permission = this.permissions.decideRecord(permissionId, request.decision);
        const session = this.requireSession(permission.sessionId);
        const updated =
          session.status === 'waiting_permission'
            ? this.database.sessions.updateStatus(session.id, 'running', this.now().toISOString())!
            : session;
        const response = {
          requestId: request.requestId,
          permission,
          session: this.summary(updated),
        };
        committedEvents.push(
          this.events.append({
            sessionId: permission.sessionId,
            requestId: request.requestId,
            type: 'permission.resolved',
            payload: { permission },
          }),
          this.events.append({
            sessionId: response.session.id,
            requestId: request.requestId,
            type: 'session.updated',
            payload: { session: response.session },
          }),
        );
        return response;
      },
    );
    if (!result.replayed) {
      this.permissions.completeDecision(result.value.permission);
      committedEvents.forEach((event) => this.events.publish(event));
    }
    return result.value;
  }

  private startTurn(sessionId: string, requestId: string, prompt: string, cwd: string): void {
    const controller = new AbortController();
    this.activeTurns.set(sessionId, controller);
    void this.runTurn(sessionId, requestId, prompt, cwd, controller);
  }

  private resumeTurnIfNeeded(
    sessionId: string,
    requestId: string,
    prompt: string,
  ): SessionRecord | null {
    const session = this.requireSession(sessionId);
    if (this.activeTurns.has(sessionId)) {
      return null;
    }
    if (session.status !== 'running' && session.status !== 'interrupted') {
      return null;
    }

    const cwd = this.projects.resolveForExecution(session.projectId);
    const running =
      session.status === 'interrupted'
        ? this.database.sessions.updateStatus(sessionId, 'running', this.now().toISOString())!
        : session;
    this.startTurn(sessionId, requestId, prompt, cwd);
    return running;
  }

  private async runTurn(
    sessionId: string,
    requestId: string,
    prompt: string,
    cwd: string,
    controller: AbortController,
  ): Promise<void> {
    const assistantMessageId = randomUUID();
    const toolIds = new Map<string, string>();
    let deltaSequence = 0;
    let assistantMessagePersisted = false;
    try {
      const session = this.requireSession(sessionId);
      for await (const event of this.adapter.runTurn({
        localSessionId: sessionId,
        claudeSessionId: session.claudeSessionId,
        prompt,
        cwd,
        signal: controller.signal,
        requestPermission: async (permissionRequest) => {
          const waiting = this.database.sessions.updateStatus(
            sessionId,
            'waiting_permission',
            this.now().toISOString(),
          )!;
          this.events.persist({
            sessionId,
            requestId,
            type: 'session.updated',
            payload: { session: this.summary(waiting) },
          });
          const pending = this.permissions.request(sessionId, requestId, {
            ...permissionRequest,
            toolCallId: permissionRequest.toolCallId
              ? (toolIds.get(permissionRequest.toolCallId) ?? null)
              : null,
          });
          const decision = await pending.decision;
          const current = this.requireSession(sessionId);
          if (current.status === 'waiting_permission') {
            const running = this.database.sessions.updateStatus(
              sessionId,
              'running',
              this.now().toISOString(),
            )!;
            this.events.persist({
              sessionId,
              requestId,
              type: 'session.updated',
              payload: { session: this.summary(running) },
            });
          }
          return decision;
        },
      })) {
        if (controller.signal.aborted) return;
        if (event.type === 'assistant.delta') {
          this.events.transient({
            sessionId,
            requestId,
            type: 'assistant.delta',
            payload: {
              messageId: assistantMessageId,
              delta: event.text,
              sequence: deltaSequence++,
            },
          });
        } else if (event.type === 'assistant.completed') {
          const message = this.database.messages.create({
            id: assistantMessageId,
            sessionId,
            role: 'assistant',
            contentJson: JSON.stringify({ text: event.text }),
            isPartial: false,
            createdAt: this.now().toISOString(),
          });
          assistantMessagePersisted = true;
          this.events.persist({
            sessionId,
            requestId,
            type: 'message.created',
            payload: { message: serializeMessage(message) },
          });
        } else if (event.type === 'tool.started') {
          const localId = randomUUID();
          toolIds.set(event.toolCallId, localId);
          const tool = this.database.toolCalls.create({
            id: localId,
            sessionId,
            toolName: event.toolName,
            inputJson: JSON.stringify(event.input),
            outputJson: null,
            status: 'running',
            createdAt: this.now().toISOString(),
            completedAt: null,
          });
          this.events.persist({
            sessionId,
            requestId,
            type: 'tool.started',
            payload: { toolCall: serializeToolCall(tool) },
          });
        } else if (event.type === 'tool.completed') {
          const localId = toolIds.get(event.toolCallId);
          if (!localId) continue;
          const tool = this.database.toolCalls.complete(
            localId,
            event.isError ? 'failed' : 'completed',
            JSON.stringify(event.output),
            this.now().toISOString(),
          )!;
          this.events.persist({
            sessionId,
            requestId,
            type: 'tool.completed',
            payload: { toolCall: serializeToolCall(tool) },
          });
        } else if (event.type === 'turn.completed') {
          if (event.claudeSessionId) {
            this.database.sessions.updateClaudeSessionId(
              sessionId,
              event.claudeSessionId,
              this.now().toISOString(),
            );
          }
          const idle = this.database.sessions.updateStatus(
            sessionId,
            'idle',
            this.now().toISOString(),
          )!;
          this.events.persist({
            sessionId,
            requestId,
            type: 'turn.completed',
            payload: {
              session: this.summary(idle),
              assistantMessageId: assistantMessagePersisted ? assistantMessageId : null,
            },
          });
        } else if (event.type === 'turn.failed') {
          this.failTurn(sessionId, requestId, event.message);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.failTurn(sessionId, requestId, error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (this.activeTurns.get(sessionId) === controller) {
        this.activeTurns.delete(sessionId);
      }
    }
  }

  private failTurn(sessionId: string, requestId: string, message: string): void {
    const current = this.requireSession(sessionId);
    if (current.status === 'interrupted' || current.status === 'archived') return;
    const interrupted = this.database.sessions.updateStatus(
      sessionId,
      'interrupted',
      this.now().toISOString(),
    )!;
    const safeMessage = message.trim().slice(0, 2_000) || 'Claude turn failed.';
    this.events.persist({
      sessionId,
      requestId,
      type: 'turn.failed',
      payload: {
        session: this.summary(interrupted),
        code: 'CLAUDE_TURN_FAILED',
        message: safeMessage,
        retryable: true,
      },
    });
  }

  private userMessage(sessionId: string, text: string, createdAt: string): MessageRecord {
    return {
      id: randomUUID(),
      sessionId,
      role: 'user',
      contentJson: JSON.stringify({ text }),
      isPartial: false,
      createdAt,
    };
  }

  private requireSession(sessionId: string): SessionRecord {
    const session = this.database.sessions.get(sessionId);
    if (!session) throw new SessionNotFoundError('Session not found.');
    return session;
  }

  private project(session: SessionRecord): ProjectRecord {
    const project = this.projects.list().find((candidate) => candidate.id === session.projectId);
    return (
      project ?? {
        id: session.projectId,
        displayName: 'Unavailable project',
        rootPath: '',
        createdAt: session.createdAt,
      }
    );
  }

  private summary(session: SessionRecord): SessionSummary {
    return serializeSessionSummary(
      session,
      this.project(session),
      this.database.messages.listBySession(session.id),
    );
  }

  private serializeDetail(session: SessionRecord): SessionDetail {
    return serializeSessionDetail(
      session,
      this.project(session),
      this.database.messages.listBySession(session.id),
      this.database.toolCalls.listBySession(session.id),
      this.database.permissions.listBySession(session.id),
    );
  }
}

export { IdempotencyConflictError };
