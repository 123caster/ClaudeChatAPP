import { describe, expect, it, vi } from 'vitest';

import {
  closeDatabase,
  createDatabase,
  IdempotencyConflictError,
  type SessionRecord,
} from '../index.js';

const createdAt = '2026-08-13T08:00:00.000Z';

function setup() {
  const database = createDatabase(':memory:');
  database.projects.upsert({
    id: 'project-1',
    displayName: 'Project',
    rootPath: 'D:\\Projects\\project',
    createdAt,
  });
  return database;
}

function session(id: string, status: SessionRecord['status'] = 'idle'): SessionRecord {
  return {
    id,
    claudeSessionId: null,
    projectId: 'project-1',
    title: id,
    status,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

describe('session repositories', () => {
  it('creates, reads, lists, updates and archives sessions', () => {
    const database = setup();
    database.sessions.create(session('session-1'));

    expect(database.sessions.get('session-1')).toEqual(session('session-1'));
    expect(
      database.sessions.updateClaudeSessionId('session-1', 'claude-1', '2026-08-13T08:01:00.000Z'),
    ).toMatchObject({ claudeSessionId: 'claude-1' });
    expect(
      database.sessions.updateStatus('session-1', 'running', '2026-08-13T08:02:00.000Z'),
    ).toMatchObject({ status: 'running' });
    expect(database.sessions.list()).toHaveLength(1);
    expect(database.sessions.archive('session-1', '2026-08-13T08:03:00.000Z')).toMatchObject({
      status: 'archived',
      archivedAt: '2026-08-13T08:03:00.000Z',
    });
    expect(database.sessions.list()).toEqual([]);
    expect(database.sessions.list({ includeArchived: true })).toHaveLength(1);
    closeDatabase(database);
  });

  it('recovers running and waiting sessions as interrupted', () => {
    const database = setup();
    database.sessions.create(session('running', 'running'));
    database.sessions.create(session('waiting', 'waiting_permission'));
    database.sessions.create(session('idle', 'idle'));

    expect(database.sessions.recoverInterrupted('2026-08-13T09:00:00.000Z')).toBe(2);
    expect(database.sessions.get('running')).toMatchObject({ status: 'interrupted' });
    expect(database.sessions.get('waiting')).toMatchObject({ status: 'interrupted' });
    expect(database.sessions.get('idle')).toMatchObject({ status: 'idle' });
    closeDatabase(database);
  });

  it('persists messages and tool calls', () => {
    const database = setup();
    database.sessions.create(session('session-1'));
    database.messages.create({
      id: 'message-1',
      sessionId: 'session-1',
      role: 'assistant',
      contentJson: '{"text":"hel"}',
      isPartial: true,
      createdAt,
    });
    database.messages.updateContent('message-1', '{"text":"hello"}', false);
    expect(database.messages.listBySession('session-1')).toEqual([
      expect.objectContaining({ contentJson: '{"text":"hello"}', isPartial: false }),
    ]);

    database.toolCalls.create({
      id: 'tool-1',
      sessionId: 'session-1',
      toolName: 'Read',
      inputJson: '{"path":"README.md"}',
      outputJson: null,
      status: 'running',
      createdAt,
      completedAt: null,
    });
    database.toolCalls.complete('tool-1', 'completed', '{"ok":true}', '2026-08-13T08:01:00.000Z');
    expect(database.toolCalls.listBySession('session-1')).toEqual([
      expect.objectContaining({ status: 'completed', outputJson: '{"ok":true}' }),
    ]);
    closeDatabase(database);
  });

  it('appends and resumes events by cursor', () => {
    const database = setup();
    database.sessions.create(session('session-1'));
    expect(database.events.currentId()).toBe(0);
    expect(database.events.minimumId()).toBe(0);

    const first = database.events.append({
      sessionId: 'session-1',
      requestId: 'request-1',
      type: 'assistant.delta',
      payloadJson: '{"text":"a"}',
      emittedAt: createdAt,
    });
    const second = database.events.append({
      sessionId: 'session-1',
      requestId: null,
      type: 'turn.completed',
      payloadJson: '{}',
      emittedAt: '2026-08-13T08:01:00.000Z',
    });

    expect(first.id).toBe(1);
    expect(database.events.minimumId()).toBe(1);
    expect(database.events.currentId()).toBe(second.id);
    expect(database.events.listAfter(first.id, 10)).toEqual([second]);
    expect(database.events.listAfter(0, 1)).toEqual([first]);
    closeDatabase(database);
  });

  it('decides a permission only once and cancels unresolved requests on recovery', () => {
    const database = setup();
    database.sessions.create(session('session-1'));
    const permission = {
      id: 'permission-1',
      sessionId: 'session-1',
      toolCallId: null,
      requestJson: '{"tool":"Bash"}',
      decision: null,
      decisionMessage: null,
      createdAt,
      expiresAt: '2026-08-13T08:10:00.000Z',
      resolvedAt: null,
    } as const;
    database.permissions.create(permission);
    database.permissions.create({ ...permission, id: 'permission-2' });

    expect(
      database.permissions.decide('permission-1', 'allow_once', null, '2026-08-13T08:01:00.000Z'),
    ).toMatchObject({ status: 'decided', permission: { decision: 'allow_once' } });
    expect(
      database.permissions.decide(
        'permission-1',
        'deny',
        'changed mind',
        '2026-08-13T08:02:00.000Z',
      ),
    ).toMatchObject({ status: 'already_resolved', permission: { decision: 'allow_once' } });
    expect(database.permissions.cancelUnresolved('2026-08-13T08:03:00.000Z', 'restart')).toBe(1);
    expect(database.permissions.listUnresolved()).toEqual([]);
    expect(database.permissions.get('permission-2')).toMatchObject({ decision: 'cancelled' });
    closeDatabase(database);
  });

  it('executes a request once, replays its result and rejects conflicting reuse', () => {
    const database = setup();
    const operation = vi.fn(() => {
      database.sessions.create(session('session-1'));
      return { sessionId: 'session-1' };
    });
    const request = {
      requestId: 'request-1',
      operation: 'sessions.create',
      fingerprint: 'sha256:one',
      createdAt,
      completedAt: '2026-08-13T08:00:01.000Z',
    };

    expect(database.idempotency.execute(request, operation)).toEqual({
      replayed: false,
      value: { sessionId: 'session-1' },
    });
    expect(database.idempotency.execute(request, operation)).toEqual({
      replayed: true,
      value: { sessionId: 'session-1' },
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(() =>
      database.idempotency.execute({ ...request, fingerprint: 'sha256:two' }, operation),
    ).toThrow(IdempotencyConflictError);
    closeDatabase(database);
  });

  it('rolls back writes and does not reserve requestId when an operation fails', () => {
    const database = setup();
    const request = {
      requestId: 'request-failed',
      operation: 'sessions.create',
      fingerprint: 'sha256:failed',
      createdAt,
      completedAt: createdAt,
    };

    expect(() =>
      database.idempotency.execute(request, () => {
        database.sessions.create(session('session-failed'));
        database.events.append({
          sessionId: 'session-failed',
          requestId: request.requestId,
          type: 'session.created',
          payloadJson: '{}',
          emittedAt: createdAt,
        });
        throw new Error('failed');
      }),
    ).toThrow('failed');
    expect(database.sessions.get('session-failed')).toBeNull();
    expect(database.events.currentId()).toBe(0);
    expect(database.idempotency.get(request.requestId)).toBeNull();
    closeDatabase(database);
  });
});
