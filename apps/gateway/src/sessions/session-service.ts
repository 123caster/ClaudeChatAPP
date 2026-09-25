import { createHash, randomUUID } from 'node:crypto';

import {
  IdempotencyConflictError,
  type AttachmentRecord,
  type DatabaseClient,
  type MessageRecord,
  type ProjectRecord,
  type SessionRecord,
} from '@claude-chat/database';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  ClearSessionResponse,
  EventEnvelope,
  PermissionDecisionRequest,
  PermissionDecisionResponse,
  RenameSessionRequest,
  RenameSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
  SetSessionModelRequest,
  SetSessionModelResponse,
  SessionDetail,
  SessionSummary,
  WriteActionRequest,
  ErrorCode,
} from '@claude-chat/protocol';

import { AttachmentError, type AttachmentService } from '../attachments/attachment-service.js';
import type { ClaudeAdapter } from '../claude/claude-adapter.js';
import type { MultimodalRouter } from '../claude/multimodal-router.js';
import type { EventStore } from '../events/event-store.js';
import type { ActiveModelConfig, ModelService } from '../models/model-service.js';
import type { ModeService } from '../mode/mode-service.js';
import type { ProjectRegistry } from '../projects/project-registry.js';
import {
  canAutoApproveScheduledRead,
  canAutoApproveScheduledWrite,
} from '../scheduled/scheduled-permission-policy.js';
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

type ScheduledTurnPolicy = {
  allowAutoWrite: boolean;
};

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function compactSuccessMessage(output: string): string {
  const detail = output.trim();
  return detail ? `上下文压缩成功\n\n${detail}` : '上下文压缩成功';
}

function sanitizeCompactFailure(message: string): string {
  const sanitized = message
    .replace(/(api[_ -]?key|token|authorization)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
    .replace(/(?:[A-Za-z]:\\|\/(?:home|srv|opt|var)\/)[^\s]*/g, '[PATH]')
    .trim()
    .slice(0, 1_800);
  return sanitized || 'Claude 未返回具体原因。';
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
    private readonly models?: ModelService,
    private readonly modes?: ModeService,
    private readonly attachments?: AttachmentService,
    private readonly multimodal?: MultimodalRouter,
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

  public create(
    request: CreateSessionRequest,
    deviceId: string | null = null,
  ): CreateSessionResponse {
    let cwdForStart: string | null = null;
    let turnAttachments: AttachmentRecord[] = [];
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
        const selectedAttachments = this.selectAttachments(
          deviceId,
          null,
          request.attachmentIds ?? [],
        );
        const activeModel = this.resolveTurnModel(null);
        this.assertAttachmentsSupported(selectedAttachments, activeModel);
        cwdForStart = this.projects.resolveForExecution(
          request.projectId,
          request.workingDirectory ?? null,
        );
        const timestamp = this.now().toISOString();
        const session = this.database.sessions.create({
          id: randomUUID(),
          claudeSessionId: null,
          projectId: request.projectId,
          workingDirectory: request.workingDirectory ?? null,
          modelId: activeModel?.id ?? null,
          title:
            request.title ??
            (request.message.slice(0, 80) ||
              selectedAttachments
                .map((attachment) => attachment.name)
                .join('、')
                .slice(0, 80) ||
              '附件提问'),
          status: 'running',
          createdAt: timestamp,
          updatedAt: timestamp,
          archivedAt: null,
        });
        const message = this.database.messages.create(
          this.userMessage(session.id, request.message, timestamp),
        );
        this.attachments?.bindToMessage(selectedAttachments, session.id, message.id, timestamp);
        turnAttachments = this.database.attachments.listByMessageIds([message.id]);
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
            payload: { message: serializeMessage(message, turnAttachments) },
          }),
        );
        return response;
      },
    );

    if (!result.replayed) {
      committedEvents.forEach((event) => this.events.publish(event));
      this.startTurn(
        result.value.session.id,
        request.requestId,
        request.message,
        cwdForStart!,
        turnAttachments,
      );
      return result.value;
    }

    const resumed = this.resumeTurnIfNeeded(
      result.value.session.id,
      request.requestId,
      request.message,
      this.boundAttachments(request.attachmentIds ?? []),
    );
    if (resumed) {
      return { requestId: request.requestId, session: this.serializeDetail(resumed) };
    }
    return {
      requestId: request.requestId,
      session: this.serializeDetail(this.requireSession(result.value.session.id)),
    };
  }

  public sendMessage(
    sessionId: string,
    request: SendMessageRequest,
    deviceId: string | null = null,
    scheduledPolicy?: ScheduledTurnPolicy,
    executionPrompt?: string,
  ): SendMessageResponse {
    const turnPrompt = executionPrompt ?? request.message;
    let cwdForStart: string | null = null;
    let turnAttachments: AttachmentRecord[] = [];
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
        const selectedAttachments = this.selectAttachments(
          deviceId,
          sessionId,
          request.attachmentIds ?? [],
        );
        cwdForStart = this.projects.resolveForExecution(
          session.projectId,
          session.workingDirectory ?? null,
        );
        try {
          assertSessionTransition(session.status, 'running');
        } catch {
          throw new SessionConflictError('Session is not ready for a new message.');
        }
        this.assertAttachmentsSupported(
          selectedAttachments,
          this.resolveTurnModel(session.modelId),
        );
        const timestamp = this.now().toISOString();
        const message = this.database.messages.create(
          this.userMessage(sessionId, request.message, timestamp),
        );
        this.attachments?.bindToMessage(selectedAttachments, sessionId, message.id, timestamp);
        turnAttachments = this.database.attachments.listByMessageIds([message.id]);
        const updated = this.database.sessions.updateStatus(sessionId, 'running', timestamp)!;
        const response = {
          requestId: request.requestId,
          message: serializeMessage(message, turnAttachments),
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
      this.startTurn(
        sessionId,
        request.requestId,
        turnPrompt,
        cwdForStart!,
        turnAttachments,
        scheduledPolicy,
      );
      return result.value;
    }

    const resumed = this.resumeTurnIfNeeded(
      sessionId,
      request.requestId,
      turnPrompt,
      this.boundAttachments(request.attachmentIds ?? []),
      scheduledPolicy,
    );
    if (resumed) {
      return { ...result.value, session: this.summary(resumed) };
    }
    return {
      ...result.value,
      session: this.summary(this.requireSession(sessionId)),
    };
  }

  public runScheduledTask(
    sessionId: string,
    requestId: string,
    displayPrompt: string,
    executionPrompt: string,
    allowAutoWrite: boolean,
  ): SendMessageResponse {
    if (!this.database.sessions.isScheduled(sessionId)) {
      throw new SessionConflictError('Session is not owned by a scheduled task.');
    }
    return this.sendMessage(
      sessionId,
      { requestId, message: displayPrompt },
      null,
      { allowAutoWrite },
      executionPrompt,
    );
  }

  public setModel(sessionId: string, request: SetSessionModelRequest): SetSessionModelResponse {
    const result = this.database.idempotency.execute<SetSessionModelResponse>(
      {
        requestId: request.requestId,
        operation: `session.model:${sessionId}`,
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const session = this.requireSession(sessionId);
        if (session.status === 'running' || session.status === 'waiting_permission') {
          throw new SessionConflictError('Cannot change the model while a turn is running.');
        }
        if (!this.models?.get(request.modelId))
          throw new SessionConflictError('Selected model is unavailable.');
        const updated = this.database.sessions.setModel(
          sessionId,
          request.modelId,
          this.now().toISOString(),
        )!;
        return { requestId: request.requestId, session: this.summary(updated) };
      },
    );
    if (!result.replayed) {
      this.events.persist({
        sessionId,
        requestId: request.requestId,
        type: 'session.updated',
        payload: { session: result.value.session },
      });
    }
    return result.value;
  }

  public rename(sessionId: string, request: RenameSessionRequest): RenameSessionResponse {
    const result = this.database.idempotency.execute<RenameSessionResponse>(
      {
        requestId: request.requestId,
        operation: `session.rename:${sessionId}`,
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const session = this.requireSession(sessionId);
        const updated = this.database.sessions.updateTitle(
          session.id,
          request.title.trim(),
          this.now().toISOString(),
        );
        if (!updated) throw new SessionNotFoundError();
        return { requestId: request.requestId, session: this.summary(updated) };
      },
    );
    if (!result.replayed) {
      this.events.persist({
        sessionId,
        requestId: request.requestId,
        type: 'session.updated',
        payload: { session: result.value.session },
      });
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
        const updated = this.database.sessions.interrupt(
          sessionId,
          'cancelled',
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

  public clear(sessionId: string, request: WriteActionRequest): ClearSessionResponse {
    const activeTurn = this.activeTurns.get(sessionId);
    activeTurn?.abort();
    this.permissions.cancelSession(sessionId, 'Conversation cleared by the user.');
    const attachmentsToDelete = this.database.attachments.listBySession(sessionId);

    const result = this.database.idempotency.execute<ClearSessionResponse>(
      {
        requestId: request.requestId,
        operation: `session.clear:${sessionId}`,
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const session = this.requireSession(sessionId);
        if (session.status === 'archived') {
          throw new SessionConflictError('Archived sessions cannot be cleared.');
        }
        this.database.events.deleteBySession(sessionId);
        this.database.permissions.deleteBySession(sessionId);
        this.database.toolCalls.deleteBySession(sessionId);
        this.database.messages.deleteBySession(sessionId);
        const reset = this.database.sessions.resetConversation(sessionId, this.now().toISOString());
        if (!reset) throw new SessionNotFoundError();
        return { requestId: request.requestId, session: this.serializeDetail(reset) };
      },
    );

    if (!result.replayed) {
      this.attachments?.deleteFiles(attachmentsToDelete);
      this.events.persist({
        sessionId,
        requestId: request.requestId,
        type: 'session.updated',
        payload: { session: this.summary(this.requireSession(sessionId)) },
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

  public delete(sessionId: string, request: WriteActionRequest): void {
    const attachmentsToDelete = this.database.attachments.listBySession(sessionId);
    const result = this.database.idempotency.execute<{ sessionId: string }>(
      {
        requestId: request.requestId,
        operation: `session.delete:${sessionId}`,
        fingerprint: fingerprint(request),
        createdAt: this.now().toISOString(),
        completedAt: this.now().toISOString(),
      },
      () => {
        const session = this.requireSession(sessionId);
        if (session.status === 'running' || session.status === 'waiting_permission') {
          throw new SessionConflictError('Active sessions cannot be deleted.');
        }
        if (!this.database.sessions.delete(sessionId)) {
          throw new SessionNotFoundError();
        }
        return { sessionId };
      },
    );
    if (!result.replayed) {
      this.attachments?.deleteFiles(attachmentsToDelete);
    }
    // Note: no event is persisted after a delete. A `session.deleted` event would
    // need a still-existing session row to satisfy the events.session_id foreign
    // key, but we have already removed it. The delete is terminal, so clients
    // rely on the direct API response to drop the session locally.
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
        const permission = this.permissions.decideRecord(
          permissionId,
          request.decision,
          request.answer ?? null,
        );
        const session = this.requireSession(permission.sessionId);
        const updated =
          session.status === 'waiting_permission' &&
          !this.permissions.hasOtherPendingForSession(session.id, permission.id)
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

  private startTurn(
    sessionId: string,
    requestId: string,
    prompt: string,
    cwd: string,
    attachments: readonly AttachmentRecord[] = [],
    scheduledPolicy?: ScheduledTurnPolicy,
  ): void {
    const controller = new AbortController();
    this.activeTurns.set(sessionId, controller);
    void this.runTurn(sessionId, requestId, prompt, cwd, controller, attachments, scheduledPolicy);
  }

  private resumeTurnIfNeeded(
    sessionId: string,
    requestId: string,
    prompt: string,
    attachments: readonly AttachmentRecord[] = [],
    scheduledPolicy?: ScheduledTurnPolicy,
  ): SessionRecord | null {
    const session = this.requireSession(sessionId);
    if (this.activeTurns.has(sessionId)) {
      return null;
    }
    if (session.status !== 'running' && session.status !== 'interrupted') {
      return null;
    }
    if (
      session.status === 'interrupted' &&
      !scheduledPolicy &&
      !this.database.sessions.canResumeInterrupted(sessionId)
    ) {
      return null;
    }

    const cwd = this.projects.resolveForExecution(
      session.projectId,
      session.workingDirectory ?? null,
    );
    const running =
      session.status === 'interrupted'
        ? this.database.sessions.updateStatus(sessionId, 'running', this.now().toISOString())!
        : session;
    this.startTurn(sessionId, requestId, prompt, cwd, attachments, scheduledPolicy);
    return running;
  }

  private async runTurn(
    sessionId: string,
    requestId: string,
    prompt: string,
    cwd: string,
    controller: AbortController,
    attachments: readonly AttachmentRecord[],
    scheduledPolicy?: ScheduledTurnPolicy,
  ): Promise<void> {
    const assistantMessageId = randomUUID();
    const toolIds = new Map<string, string>();
    const completedToolIds = new Set<string>();
    let deltaSequence = 0;
    let assistantMessagePersisted = false;
    let terminalEventSeen = false;
    let streamedAssistantText = '';
    const compactCommand = prompt.trim() === '/compact';
    try {
      const session = this.requireSession(sessionId);
      const activeModel = this.resolveTurnModel(session.modelId);
      const permissionMode = scheduledPolicy ? 'default' : (this.modes?.get() ?? 'default');
      const preparedPrompt = this.multimodal
        ? await this.multimodal.prepare(prompt, attachments, activeModel)
        : attachments.length > 0
          ? (() => {
              throw new AttachmentError(
                503,
                'MULTIMODAL_MODEL_UNAVAILABLE',
                'Attachment processing is not available.',
              );
            })()
          : prompt;
      for await (const event of this.adapter.runTurn({
        localSessionId: sessionId,
        claudeSessionId: session.claudeSessionId,
        prompt: preparedPrompt,
        cwd,
        signal: controller.signal,
        permissionMode,
        ...(activeModel ? { modelConfig: activeModel } : {}),
        requestPermission: async (permissionRequest) => {
          if (
            scheduledPolicy &&
            (canAutoApproveScheduledRead(permissionRequest) ||
              canAutoApproveScheduledWrite(permissionRequest, cwd, scheduledPolicy.allowAutoWrite))
          ) {
            return { decision: 'allow_once' };
          }
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
          let localToolId: string | null = null;
          if (permissionRequest.toolCallId) {
            localToolId = toolIds.get(permissionRequest.toolCallId) ?? null;
            if (!localToolId) {
              localToolId = randomUUID();
              toolIds.set(permissionRequest.toolCallId, localToolId);
              const tool = this.database.toolCalls.create({
                id: localToolId,
                sessionId,
                toolName: permissionRequest.toolName,
                inputJson: JSON.stringify(permissionRequest.input),
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
            }
          }
          const pending = this.permissions.request(sessionId, requestId, {
            ...permissionRequest,
            toolCallId: localToolId,
          });
          const decision = await pending.decision;
          const current = this.requireSession(sessionId);
          if (
            current.status === 'waiting_permission' &&
            !this.permissions.hasPendingForSession(sessionId)
          ) {
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
        if (event.type === 'session.started') {
          const currentClaudeSessionId = this.requireSession(sessionId).claudeSessionId;
          if (currentClaudeSessionId && currentClaudeSessionId !== event.claudeSessionId) {
            throw new Error('Claude resumed with a different session ID.');
          }
          this.database.sessions.updateClaudeSessionId(
            sessionId,
            event.claudeSessionId,
            this.now().toISOString(),
          );
        } else if (event.type === 'assistant.delta') {
          streamedAssistantText += event.text;
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
          if (!assistantMessagePersisted) {
            const output = event.text.trim() ? event.text : streamedAssistantText;
            this.persistAssistantMessage(
              sessionId,
              requestId,
              assistantMessageId,
              compactCommand ? compactSuccessMessage(output) : output,
            );
            assistantMessagePersisted = true;
          }
        } else if (event.type === 'tool.started') {
          if (!toolIds.has(event.toolCallId)) {
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
          }
        } else if (event.type === 'tool.completed') {
          if (completedToolIds.has(event.toolCallId)) continue;
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
          completedToolIds.add(event.toolCallId);
        } else if (event.type === 'turn.completed') {
          terminalEventSeen = true;
          if (!assistantMessagePersisted && (compactCommand || streamedAssistantText.trim())) {
            this.persistAssistantMessage(
              sessionId,
              requestId,
              assistantMessageId,
              compactCommand ? compactSuccessMessage(streamedAssistantText) : streamedAssistantText,
            );
            assistantMessagePersisted = true;
          }
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
          terminalEventSeen = true;
          if (compactCommand && !assistantMessagePersisted) {
            this.persistAssistantMessage(
              sessionId,
              requestId,
              assistantMessageId,
              `上下文压缩失败：${sanitizeCompactFailure(event.message)}`,
            );
            assistantMessagePersisted = true;
          }
          this.failTurn(sessionId, requestId, event.message);
          break;
        }
      }
      if (!controller.signal.aborted && !terminalEventSeen) {
        this.failTurn(
          sessionId,
          requestId,
          'Claude event stream ended before a result was received.',
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        if (compactCommand && !assistantMessagePersisted) {
          this.persistAssistantMessage(
            sessionId,
            requestId,
            assistantMessageId,
            `上下文压缩失败：${sanitizeCompactFailure(message)}`,
          );
        }
        this.failTurn(
          sessionId,
          requestId,
          message,
          error instanceof AttachmentError ? error.code : 'CLAUDE_TURN_FAILED',
          error instanceof AttachmentError ? error.retryable : true,
        );
      }
    } finally {
      await this.attachments?.releaseOriginals(attachments);
      if (this.activeTurns.get(sessionId) === controller) {
        this.activeTurns.delete(sessionId);
      }
    }
  }

  private persistAssistantMessage(
    sessionId: string,
    requestId: string,
    messageId: string,
    text: string,
  ): void {
    const message = this.database.messages.create({
      id: messageId,
      sessionId,
      role: 'assistant',
      contentJson: JSON.stringify({ text }),
      isPartial: false,
      createdAt: this.now().toISOString(),
    });
    this.events.persist({
      sessionId,
      requestId,
      type: 'message.created',
      payload: { message: serializeMessage(message) },
    });
  }

  private failTurn(
    sessionId: string,
    requestId: string,
    message: string,
    code: ErrorCode | 'CLAUDE_TURN_FAILED' = 'CLAUDE_TURN_FAILED',
    retryable = true,
  ): void {
    const current = this.requireSession(sessionId);
    if (current.status === 'interrupted' || current.status === 'archived') return;
    const interrupted = this.database.sessions.interrupt(
      sessionId,
      'failed',
      this.now().toISOString(),
    )!;
    const safeMessage = message.trim().slice(0, 2_000) || 'Claude turn failed.';
    this.events.persist({
      sessionId,
      requestId,
      type: 'turn.failed',
      payload: {
        session: this.summary(interrupted),
        code,
        message: safeMessage,
        retryable,
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

  private selectAttachments(
    deviceId: string | null,
    sessionId: string | null,
    attachmentIds: readonly string[],
  ): AttachmentRecord[] {
    if (attachmentIds.length === 0) return [];
    if (!deviceId) {
      throw new AttachmentError(
        401,
        'UNAUTHORIZED',
        'A paired device is required for attachments.',
      );
    }
    if (!this.attachments) {
      throw new AttachmentError(
        503,
        'ATTACHMENT_NOT_READY',
        'Attachment processing is unavailable.',
      );
    }
    return this.attachments.selectForMessage(deviceId, sessionId, attachmentIds);
  }

  private resolveTurnModel(modelId: string | null | undefined): ActiveModelConfig | null {
    return (modelId ? this.models?.get(modelId) : null) ?? this.models?.getActive() ?? null;
  }

  private assertAttachmentsSupported(
    attachments: readonly AttachmentRecord[],
    currentModel: ActiveModelConfig | null,
  ): void {
    if (attachments.length === 0) return;
    if (!this.multimodal) {
      throw new AttachmentError(
        503,
        'MULTIMODAL_MODEL_UNAVAILABLE',
        'Attachment processing is not available.',
      );
    }
    this.multimodal.assertConfigured(attachments, currentModel);
  }

  private boundAttachments(attachmentIds: readonly string[]): AttachmentRecord[] {
    return attachmentIds.flatMap((id) => {
      const attachment = this.database.attachments.get(id);
      return attachment?.status === 'bound' ? [attachment] : [];
    });
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
    const messages = this.database.messages.listBySession(session.id);
    return serializeSessionDetail(
      session,
      this.project(session),
      messages,
      this.database.toolCalls.listBySession(session.id),
      this.database.permissions.listBySession(session.id),
      this.database.attachments.listByMessageIds(messages.map((message) => message.id)),
    );
  }
}

export { IdempotencyConflictError };
