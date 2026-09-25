import { describe, expect, it } from 'vitest';

import {
  closeDatabase,
  createDatabase,
  type CreateScheduledRunRecord,
  type CreateScheduledTaskRecord,
  type SessionRecord,
} from '../index.js';

const createdAt = '2026-09-16T01:00:00.000Z';

function session(id: string): SessionRecord {
  return {
    id,
    claudeSessionId: null,
    projectId: 'home',
    workingDirectory: 'myclaude',
    modelId: null,
    title: '每日摘要',
    status: 'idle',
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

function task(id = 'task-1'): CreateScheduledTaskRecord {
  return {
    id,
    name: '每日摘要',
    prompt: '总结项目进展。',
    status: 'active',
    triggerType: 'time',
    scheduleJson: JSON.stringify({ kind: 'daily', hour: 9, minute: 0 }),
    timeZone: 'Asia/Shanghai',
    nextRunAt: '2026-09-17T01:00:00.000Z',
    lastRunAt: null,
    sessionId: `session-${id}`,
    projectId: 'home',
    workingDirectory: 'myclaude',
    modelId: null,
    allowAutoWrite: false,
    notificationPolicy: 'all_results',
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

function run(
  id: string,
  scheduledFor = '2026-09-17T01:00:00.000Z',
  status: CreateScheduledRunRecord['status'] = 'queued',
): CreateScheduledRunRecord {
  const terminal = ['succeeded', 'failed', 'skipped', 'cancelled'].includes(status);
  return {
    id,
    taskId: 'task-1',
    scheduledFor,
    triggerSource: 'scheduled',
    status,
    requestId: `request-${id}`,
    userMessageId: null,
    assistantMessageId: null,
    startedAt: null,
    completedAt: terminal ? createdAt : null,
    errorCode: status === 'failed' ? 'TURN_FAILED' : null,
    errorMessage: status === 'failed' ? 'Failed.' : null,
    leaseOwner: null,
    leaseExpiresAt: null,
    notificationStatus: 'not_requested',
    readAt: terminal ? null : createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

function setup() {
  const database = createDatabase(':memory:');
  database.projects.upsert({
    id: 'home',
    displayName: 'Home',
    rootPath: '/home/ubuntu',
    createdAt,
  });
  database.sessions.createScheduled(session('session-task-1'));
  database.scheduledTasks.create(task());
  return database;
}

describe('scheduled automation repositories', () => {
  it('creates, lists, updates and soft-deletes tasks', () => {
    const database = setup();

    expect(database.scheduledTasks.get('task-1')).toMatchObject({
      name: '每日摘要',
      unreadCount: 0,
      needsAttention: false,
    });
    expect(database.scheduledTasks.listDue('2026-09-17T01:00:00.000Z')).toHaveLength(1);
    expect(
      database.scheduledTasks.update(
        'task-1',
        { allowAutoWrite: true, status: 'paused', nextRunAt: null },
        '2026-09-16T02:00:00.000Z',
      ),
    ).toMatchObject({ allowAutoWrite: true, status: 'paused', nextRunAt: null });
    expect(database.scheduledTasks.softDelete('task-1', '2026-09-16T03:00:00.000Z')).toMatchObject({
      status: 'deleted',
      deletedAt: '2026-09-16T03:00:00.000Z',
    });
    expect(database.scheduledTasks.list()).toEqual([]);
    expect(database.scheduledTasks.list({ includeDeleted: true })).toHaveLength(1);
    closeDatabase(database);
  });

  it('prevents duplicate occurrences and overlapping active runs', () => {
    const database = setup();
    database.scheduledRuns.create(run('run-1'));

    expect(() => database.scheduledRuns.create(run('run-duplicate'))).toThrow();
    expect(() =>
      database.scheduledRuns.create(run('run-overlap', '2026-09-18T01:00:00.000Z')),
    ).toThrow();
    expect(database.scheduledRuns.findActiveByTask('task-1')).toMatchObject({ id: 'run-1' });
    closeDatabase(database);
  });

  it('claims one queued run and recovers an expired lease', () => {
    const database = setup();
    database.scheduledRuns.create(run('run-1'));

    expect(
      database.scheduledRuns.claim(
        'run-1',
        'gateway-1',
        '2026-09-16T01:05:00.000Z',
        '2026-09-16T01:01:00.000Z',
      ),
    ).toMatchObject({ status: 'running', attemptCount: 1, leaseOwner: 'gateway-1' });
    expect(
      database.scheduledRuns.claim(
        'run-1',
        'gateway-2',
        '2026-09-16T01:06:00.000Z',
        '2026-09-16T01:02:00.000Z',
      ),
    ).toBeNull();
    expect(database.scheduledRuns.listExpiredLeases('2026-09-16T01:05:00.000Z')).toHaveLength(1);
    expect(
      database.scheduledRuns.releaseExpiredLeases(
        '2026-09-16T01:05:00.000Z',
        '2026-09-16T01:05:00.000Z',
      ),
    ).toBe(1);
    expect(database.scheduledRuns.get('run-1')).toMatchObject({
      status: 'queued',
      leaseOwner: null,
      attemptCount: 1,
    });
    closeDatabase(database);
  });

  it('derives unread and attention state from run history', () => {
    const database = setup();
    database.scheduledRuns.create(run('run-failed', '2026-09-17T01:00:00.000Z', 'failed'));

    expect(database.scheduledTasks.get('task-1')).toMatchObject({
      unreadCount: 1,
      needsAttention: true,
    });
    expect(database.scheduledRuns.markTaskRead('task-1', '2026-09-16T02:00:00.000Z')).toBe(1);
    expect(database.scheduledTasks.get('task-1')).toMatchObject({
      unreadCount: 0,
      needsAttention: false,
    });
    closeDatabase(database);
  });

  it('rotates Expo push tokens without exposing them through task records', () => {
    const database = setup();
    database.devices.create({
      id: 'device-1',
      name: 'Phone 1',
      tokenHash: 'hash-1',
      createdAt,
    });
    database.devices.revoke('device-1', '2026-09-16T01:01:00.000Z');
    database.devices.create({
      id: 'device-2',
      name: 'Phone 2',
      tokenHash: 'hash-2',
      createdAt,
    });

    database.pushSubscriptions.upsert({
      deviceId: 'device-1',
      provider: 'expo',
      platform: 'android',
      token: 'ExponentPushToken[same-device]',
      createdAt,
      updatedAt: createdAt,
    });
    database.pushSubscriptions.upsert({
      deviceId: 'device-2',
      provider: 'expo',
      platform: 'android',
      token: 'ExponentPushToken[same-device]',
      createdAt: '2026-09-16T02:00:00.000Z',
      updatedAt: '2026-09-16T02:00:00.000Z',
    });

    expect(database.pushSubscriptions.getByDevice('device-1')).toBeNull();
    expect(database.pushSubscriptions.listEnabled()).toEqual([
      expect.objectContaining({ deviceId: 'device-2', token: 'ExponentPushToken[same-device]' }),
    ]);
    expect(
      database.pushSubscriptions.disable('device-2', '2026-09-16T03:00:00.000Z'),
    ).toMatchObject({ enabled: false });
    expect(database.pushSubscriptions.listEnabled()).toEqual([]);
    closeDatabase(database);
  });

  it('persists Expo tickets until their receipts reach a terminal state', () => {
    const database = setup();
    database.devices.create({
      id: 'device-1',
      name: 'Phone',
      tokenHash: 'hash-1',
      createdAt,
    });
    database.pushSubscriptions.upsert({
      deviceId: 'device-1',
      provider: 'expo',
      platform: 'android',
      token: 'ExponentPushToken[receipt-device]',
      createdAt,
      updatedAt: createdAt,
    });
    database.scheduledRuns.create(run('run-receipt', createdAt, 'succeeded'));
    database.pushDeliveries.create({
      id: 'delivery-1',
      runId: 'run-receipt',
      deviceId: 'device-1',
      ticketId: 'ticket-1',
      status: 'pending',
      errorCode: null,
      attemptCount: 0,
      nextCheckAt: '2026-09-16T01:05:00.000Z',
      createdAt,
      updatedAt: createdAt,
    });

    expect(database.pushDeliveries.listDue('2026-09-16T01:05:00.000Z')).toHaveLength(1);
    expect(
      database.pushDeliveries.update(
        'delivery-1',
        { status: 'delivered', nextCheckAt: null },
        '2026-09-16T01:06:00.000Z',
      ),
    ).toMatchObject({ status: 'delivered', nextCheckAt: null });
    expect(database.pushDeliveries.listDue('2026-09-16T02:00:00.000Z')).toEqual([]);
    closeDatabase(database);
  });
});
