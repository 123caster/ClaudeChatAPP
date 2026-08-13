import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  CreateSessionRequest,
  CreateSessionResponse,
  EventEnvelope,
  PermissionDecisionRequest,
  SendMessageRequest,
  SessionDetail,
  SessionStatus,
  SessionSummary,
  SessionsResponse,
  WriteActionRequest,
} from '../index.js';

import {
  PROTOCOL_VERSION,
  createSessionRequestSchema,
  createSessionResponseSchema,
  eventEnvelopeSchema,
  permissionDecisionRequestSchema,
  sendMessageRequestSchema,
  sessionDetailSchema,
  sessionStatusSchema,
  sessionSummarySchema,
  sessionsResponseSchema,
  writeActionRequestSchema,
} from '../index.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';
const toolCallId = '33333333-3333-4333-8333-333333333333';
const permissionId = '44444444-4444-4444-8444-444444444444';
const now = '2026-08-13T08:00:00.000Z';
const later = '2026-08-13T08:10:00.000Z';

const sessionSummary = {
  id: sessionId,
  projectId: 'project_123',
  projectDisplayName: 'ClaudeChatAPP',
  title: 'Implement session events',
  status: 'running' as const,
  lastMessagePreview: 'Please add the event protocol.',
  createdAt: now,
  updatedAt: now,
};

const message = {
  id: messageId,
  sessionId,
  role: 'user' as const,
  content: 'Please add the event protocol.',
  isPartial: false,
  createdAt: now,
};

const runningToolCall = {
  id: toolCallId,
  sessionId,
  toolName: 'Read',
  input: { file_path: 'README.md' },
  output: null,
  status: 'running' as const,
  createdAt: now,
  completedAt: null,
};

const pendingPermission = {
  id: permissionId,
  sessionId,
  toolCallId,
  toolName: 'Bash',
  description: 'Run the protocol tests',
  input: { command: 'pnpm test' },
  status: 'pending' as const,
  decision: null,
  decisionMessage: null,
  createdAt: now,
  expiresAt: later,
  resolvedAt: null,
};

const sessionDetail = {
  ...sessionSummary,
  messages: [message],
  toolCalls: [runningToolCall],
  permissions: [pendingPermission],
};

const connectionEnvelope = {
  protocolVersion: PROTOCOL_VERSION,
  eventId: 1,
  sessionId: null,
  requestId: null,
  emittedAt: now,
};

const sessionEnvelope = {
  ...connectionEnvelope,
  sessionId,
  requestId: 'request_123',
};

describe('session HTTP contract', () => {
  it('keeps the fixed public type names', () => {
    expectTypeOf<SessionStatus>().toEqualTypeOf<
      'idle' | 'running' | 'waiting_permission' | 'interrupted' | 'error' | 'archived'
    >();
    expectTypeOf<SessionSummary>().toMatchObjectType<{ id: string; status: SessionStatus }>();
    expectTypeOf<SessionDetail>().toHaveProperty('messages');
    expectTypeOf<CreateSessionRequest>().toHaveProperty('requestId');
    expectTypeOf<CreateSessionResponse>().toHaveProperty('session');
    expectTypeOf<SendMessageRequest>().toHaveProperty('message');
    expectTypeOf<WriteActionRequest>().toEqualTypeOf<{ requestId: string }>();
    expectTypeOf<PermissionDecisionRequest>().toHaveProperty('decision');
    expectTypeOf<SessionsResponse>().toHaveProperty('sessions');
    expectTypeOf<EventEnvelope>().toHaveProperty('type');
  });

  it('accepts exactly the designed session states', () => {
    expect(sessionStatusSchema.options).toEqual([
      'idle',
      'running',
      'waiting_permission',
      'interrupted',
      'error',
      'archived',
    ]);
    expect(sessionStatusSchema.safeParse('paused').success).toBe(false);
  });

  it('validates strict session summaries and details', () => {
    expect(sessionSummarySchema.parse(sessionSummary)).toEqual(sessionSummary);
    expect(sessionDetailSchema.parse(sessionDetail)).toEqual(sessionDetail);
    expect(
      sessionDetailSchema.safeParse({
        ...sessionDetail,
        messages: [{ ...message, internalTrace: 'not public' }],
      }).success,
    ).toBe(false);
  });

  it('requires requestId on every write request', () => {
    expect(
      createSessionRequestSchema.parse({
        requestId: 'request_create',
        projectId: 'project_123',
        message: 'Start here',
      }),
    ).toMatchObject({ requestId: 'request_create' });
    expect(
      sendMessageRequestSchema.parse({ requestId: 'request_message', message: 'Continue' }),
    ).toMatchObject({ requestId: 'request_message' });
    expect(writeActionRequestSchema.parse({ requestId: 'request_cancel' })).toEqual({
      requestId: 'request_cancel',
    });

    for (const schema of [
      createSessionRequestSchema,
      sendMessageRequestSchema,
      writeActionRequestSchema,
      permissionDecisionRequestSchema,
    ]) {
      expect(schema.safeParse({ message: 'Missing id', decision: 'deny' }).success).toBe(false);
    }
  });

  it('limits permission decisions to allow_once and deny', () => {
    for (const decision of ['allow_once', 'deny']) {
      expect(
        permissionDecisionRequestSchema.safeParse({ requestId: 'request_permission', decision })
          .success,
      ).toBe(true);
    }

    for (const decision of ['allow', 'allow_always', 'reject']) {
      expect(
        permissionDecisionRequestSchema.safeParse({ requestId: 'request_permission', decision })
          .success,
      ).toBe(false);
    }
  });

  it('validates list and create responses with the echoed requestId', () => {
    expect(sessionsResponseSchema.parse({ sessions: [sessionSummary] }).sessions).toHaveLength(1);
    expect(
      createSessionResponseSchema.parse({
        requestId: 'request_create',
        session: sessionDetail,
      }),
    ).toMatchObject({ requestId: 'request_create' });
  });
});

describe('session event contract', () => {
  const completedToolCall = {
    ...runningToolCall,
    status: 'completed' as const,
    output: { exitCode: 0 },
    completedAt: later,
  };
  const resolvedPermission = {
    ...pendingPermission,
    status: 'resolved' as const,
    decision: 'allow_once' as const,
    decisionMessage: 'Approved on Android',
    resolvedAt: later,
  };
  const idleSession = { ...sessionSummary, status: 'idle' as const, updatedAt: later };
  const failedSession = { ...sessionSummary, status: 'interrupted' as const, updatedAt: later };

  const events = [
    {
      ...connectionEnvelope,
      type: 'connection.ready',
      payload: { gatewayVersion: '0.1.0', currentEventId: 12 },
    },
    {
      ...connectionEnvelope,
      type: 'session.snapshot',
      payload: { currentEventId: 12, sessions: [sessionDetail] },
    },
    { ...sessionEnvelope, type: 'session.created', payload: { session: sessionSummary } },
    { ...sessionEnvelope, type: 'session.updated', payload: { session: sessionSummary } },
    { ...sessionEnvelope, type: 'message.created', payload: { message } },
    {
      ...sessionEnvelope,
      type: 'assistant.delta',
      payload: { messageId, delta: 'Working', sequence: 0 },
    },
    { ...sessionEnvelope, type: 'tool.started', payload: { toolCall: runningToolCall } },
    { ...sessionEnvelope, type: 'tool.completed', payload: { toolCall: completedToolCall } },
    {
      ...sessionEnvelope,
      type: 'permission.requested',
      payload: { permission: pendingPermission },
    },
    {
      ...sessionEnvelope,
      type: 'permission.resolved',
      payload: { permission: resolvedPermission },
    },
    {
      ...sessionEnvelope,
      type: 'turn.completed',
      payload: { session: idleSession, assistantMessageId: messageId },
    },
    {
      ...sessionEnvelope,
      type: 'turn.failed',
      payload: {
        session: failedSession,
        code: 'TURN_CANCELLED',
        message: 'Cancelled by the user.',
        retryable: true,
      },
    },
    {
      ...connectionEnvelope,
      type: 'server.notice',
      payload: { level: 'info', code: 'REPLAY_COMPLETE', message: 'Replay complete.' },
    },
  ];

  it('exposes every event as one strict discriminated-union branch', () => {
    expect(eventEnvelopeSchema.options.map((option) => option.shape.type.value)).toEqual([
      'connection.ready',
      'session.snapshot',
      'session.created',
      'session.updated',
      'message.created',
      'assistant.delta',
      'tool.started',
      'tool.completed',
      'permission.requested',
      'permission.resolved',
      'turn.completed',
      'turn.failed',
      'server.notice',
    ]);

    for (const event of events) {
      expect(eventEnvelopeSchema.safeParse(event).success, event.type).toBe(true);
    }
  });

  it('rejects unknown fields at the event and payload levels', () => {
    expect(eventEnvelopeSchema.safeParse({ ...events[2], extra: true }).success).toBe(false);
    expect(
      eventEnvelopeSchema.safeParse({
        ...events[4],
        payload: { message, hidden: 'not allowed' },
      }).success,
    ).toBe(false);
  });

  it('rejects semantically inconsistent tool, permission and turn states', () => {
    expect(
      eventEnvelopeSchema.safeParse({
        ...events[6],
        payload: { toolCall: completedToolCall },
      }).success,
    ).toBe(false);
    expect(
      eventEnvelopeSchema.safeParse({
        ...events[8],
        payload: { permission: resolvedPermission },
      }).success,
    ).toBe(false);
    expect(
      eventEnvelopeSchema.safeParse({
        ...events[10],
        payload: { session: sessionSummary, assistantMessageId: messageId },
      }).success,
    ).toBe(false);
  });
});
