import { closeDatabase, createDatabase } from '@claude-chat/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ExpoPushClient } from '../push/expo-push-client.js';
import { PushService } from '../push/push-service.js';
import { ScheduledRunService } from '../scheduled/scheduled-run-service.js';

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) closeDatabase(database);
});

describe('PushService receipts', () => {
  it('keeps a run pending until Expo confirms delivery', async () => {
    const database = createDatabase(':memory:');
    databases.push(database);
    const timestamp = '2026-09-16T01:00:00.000Z';
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const taskId = '22222222-2222-4222-8222-222222222222';
    const runId = '33333333-3333-4333-8333-333333333333';
    const now = () => new Date(timestamp);
    database.projects.upsert({
      id: 'home',
      displayName: 'Home',
      rootPath: '/home/ubuntu',
      createdAt: timestamp,
    });
    database.sessions.createScheduled({
      id: sessionId,
      claudeSessionId: null,
      projectId: 'home',
      workingDirectory: null,
      modelId: null,
      title: 'Daily',
      status: 'idle',
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    });
    const task = database.scheduledTasks.create({
      id: taskId,
      name: 'Daily',
      prompt: 'Summarize.',
      status: 'active',
      triggerType: 'time',
      scheduleJson: JSON.stringify({ kind: 'daily', hour: 9, minute: 0 }),
      timeZone: 'Asia/Shanghai',
      nextRunAt: '2026-09-17T01:00:00.000Z',
      lastRunAt: null,
      sessionId,
      projectId: 'home',
      workingDirectory: null,
      modelId: null,
      allowAutoWrite: false,
      notificationPolicy: 'all_results',
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    });
    const run = database.scheduledRuns.create({
      id: runId,
      taskId: task.id,
      scheduledFor: timestamp,
      triggerSource: 'manual',
      status: 'succeeded',
      requestId: 'run-request-1',
      userMessageId: null,
      assistantMessageId: null,
      startedAt: timestamp,
      completedAt: timestamp,
      errorCode: null,
      errorMessage: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      notificationStatus: 'pending',
      readAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    database.devices.create({
      id: 'device-1',
      name: 'Phone',
      tokenHash: 'hash',
      createdAt: timestamp,
    });
    database.pushSubscriptions.upsert({
      deviceId: 'device-1',
      provider: 'expo',
      platform: 'android',
      token: 'ExponentPushToken[test]',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-1' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { 'ticket-1': { status: 'ok' } } }), {
          status: 200,
        }),
      );
    const runs = new ScheduledRunService(
      database,
      new EventStore(database.events, new EventStream(), now),
      now,
    );
    const push = new PushService(
      database,
      runs,
      true,
      new ExpoPushClient(undefined, fetcher as typeof fetch),
      now,
      { receiptDelayMs: 0 },
    );

    await push.notifyTerminal(run, task);
    expect(database.scheduledRuns.get(run.id)?.notificationStatus).toBe('pending');
    expect(database.pushDeliveries.listByRun(run.id)).toHaveLength(1);

    expect(await push.processReceipts()).toBe(1);
    expect(database.pushDeliveries.listByRun(run.id)[0]?.status).toBe('delivered');
    expect(database.scheduledRuns.get(run.id)?.notificationStatus).toBe('sent');
  });
});
