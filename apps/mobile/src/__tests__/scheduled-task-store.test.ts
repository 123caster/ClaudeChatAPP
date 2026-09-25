import type { ScheduledTask } from '@claude-chat/protocol';

import { mergeScheduledTask } from '@/state/scheduled-task-state';

function task(id: string, updatedAt: string): ScheduledTask {
  return {
    id,
    name: id,
    prompt: 'Run the task.',
    status: 'active',
    triggerType: 'time',
    schedule: { kind: 'daily', hour: 9, minute: 0 },
    timeZone: 'Asia/Shanghai',
    nextRunAt: '2026-09-17T01:00:00.000Z',
    lastRunAt: null,
    sessionId: '22222222-2222-4222-8222-222222222222',
    projectId: 'home',
    workingDirectory: null,
    modelId: null,
    allowAutoWrite: false,
    notificationPolicy: 'all_results',
    unreadCount: 0,
    needsAttention: false,
    createdAt: '2026-09-16T01:00:00.000Z',
    updatedAt,
    deletedAt: null,
  };
}

describe('scheduled task state', () => {
  it('replaces an event update without duplicating the task and keeps newest first', () => {
    const oldTask = task('11111111-1111-4111-8111-111111111111', '2026-09-16T01:00:00.000Z');
    const other = task('33333333-3333-4333-8333-333333333333', '2026-09-16T02:00:00.000Z');
    const updated = { ...oldTask, unreadCount: 1, updatedAt: '2026-09-16T03:00:00.000Z' };

    expect(mergeScheduledTask([other, oldTask], updated)).toEqual([updated, other]);
  });
});
