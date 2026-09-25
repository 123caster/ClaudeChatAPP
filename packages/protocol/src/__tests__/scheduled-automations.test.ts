import { describe, expect, it } from 'vitest';

import {
  createScheduledTaskRequestSchema,
  eventEnvelopeSchema,
  pushSubscriptionSummarySchema,
  scheduleSchema,
  scheduledRunSchema,
  scheduledTaskDraftResponseSchema,
  scheduledTaskSchema,
  updateScheduledTaskRequestSchema,
  upsertPushSubscriptionRequestSchema,
} from '../index.js';

const task = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '每日项目摘要',
  prompt: '总结今天的项目进展。',
  status: 'active' as const,
  triggerType: 'time' as const,
  schedule: { kind: 'daily' as const, hour: 9, minute: 0 },
  timeZone: 'Asia/Shanghai',
  nextRunAt: '2026-09-17T01:00:00.000Z',
  lastRunAt: null,
  sessionId: '22222222-2222-4222-8222-222222222222',
  projectId: 'home',
  workingDirectory: 'myclaude',
  modelId: null,
  allowAutoWrite: false,
  notificationPolicy: 'all_results' as const,
  unreadCount: 0,
  needsAttention: false,
  createdAt: '2026-09-16T01:00:00.000Z',
  updatedAt: '2026-09-16T01:00:00.000Z',
  deletedAt: null,
};

const run = {
  id: '33333333-3333-4333-8333-333333333333',
  taskId: task.id,
  scheduledFor: '2026-09-17T01:00:00.000Z',
  triggerSource: 'scheduled' as const,
  status: 'queued' as const,
  requestId: 'scheduled-run-2026-09-17',
  userMessageId: null,
  assistantMessageId: null,
  attemptCount: 0,
  startedAt: null,
  completedAt: null,
  errorCode: null,
  errorMessage: null,
  notificationStatus: 'not_requested' as const,
  isRead: true,
  createdAt: '2026-09-16T01:00:00.000Z',
  updatedAt: '2026-09-16T01:00:00.000Z',
};

describe('scheduled automation protocol', () => {
  it('validates every supported structured schedule', () => {
    for (const schedule of [
      { kind: 'once', localDate: '2026-10-01', hour: 9, minute: 30 },
      { kind: 'daily', hour: 9, minute: 0 },
      { kind: 'weekdays', hour: 18, minute: 15 },
      { kind: 'weekly', weekday: 1, hour: 8, minute: 0 },
      { kind: 'monthly', day: 31, hour: 23, minute: 59 },
    ]) {
      expect(scheduleSchema.safeParse(schedule).success).toBe(true);
    }

    expect(scheduleSchema.safeParse({ kind: 'daily', hour: 24, minute: 0 }).success).toBe(false);
    expect(
      scheduleSchema.safeParse({ kind: 'weekly', weekday: 0, hour: 9, minute: 0 }).success,
    ).toBe(false);
    expect(scheduleSchema.safeParse({ kind: 'cron', expression: '* * * * *' }).success).toBe(false);
  });

  it('validates task and run records without exposing credentials', () => {
    expect(scheduledTaskSchema.parse(task)).toEqual(task);
    expect(scheduledRunSchema.parse(run)).toEqual(run);
    expect(
      scheduledTaskSchema.safeParse({ ...task, pushToken: 'ExponentPushToken[secret]' }).success,
    ).toBe(false);
  });

  it('requires an explicit write policy when creating a task', () => {
    const input = {
      requestId: 'create-task-1',
      name: task.name,
      prompt: task.prompt,
      schedule: task.schedule,
      timeZone: task.timeZone,
      projectId: task.projectId,
      workingDirectory: task.workingDirectory,
      modelId: null,
      allowAutoWrite: false,
    };

    expect(createScheduledTaskRequestSchema.parse(input)).toEqual(input);
    expect(
      createScheduledTaskRequestSchema.safeParse({ ...input, allowAutoWrite: undefined }).success,
    ).toBe(false);
    expect(updateScheduledTaskRequestSchema.safeParse({ requestId: 'update-task-1' }).success).toBe(
      false,
    );
  });

  it('supports incomplete schedule drafts that still require confirmation', () => {
    expect(
      scheduledTaskDraftResponseSchema.parse({
        requestId: 'draft-1',
        draft: {
          name: '每日榜单',
          prompt: '推送最新 GitHub 榜单。',
          schedule: null,
          timeZone: 'Asia/Shanghai',
          projectId: 'home',
          workingDirectory: null,
          modelId: null,
          allowAutoWrite: false,
          missingFields: ['schedule'],
        },
      }).draft.missingFields,
    ).toEqual(['schedule']);
  });

  it('validates global task events with a null session id', () => {
    const event = eventEnvelopeSchema.parse({
      protocolVersion: 1,
      eventId: 50,
      sessionId: null,
      requestId: run.requestId,
      emittedAt: '2026-09-16T01:00:01.000Z',
      type: 'scheduled-run.created',
      payload: { run },
    });

    expect(event.type).toBe('scheduled-run.created');
  });

  it('accepts a push token only in the write request, never in the public summary', () => {
    expect(
      upsertPushSubscriptionRequestSchema.parse({
        requestId: 'push-1',
        provider: 'expo',
        platform: 'android',
        token: 'ExponentPushToken[secret]',
      }).token,
    ).toContain('secret');

    expect(
      pushSubscriptionSummarySchema.safeParse({
        deviceId: 'device-1',
        provider: 'expo',
        platform: 'android',
        enabled: true,
        updatedAt: '2026-09-16T01:00:00.000Z',
        token: 'ExponentPushToken[secret]',
      }).success,
    ).toBe(false);
  });
});
