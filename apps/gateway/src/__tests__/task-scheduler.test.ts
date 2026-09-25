import { closeDatabase, createDatabase } from '@claude-chat/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { ScheduledRunService } from '../scheduled/scheduled-run-service.js';
import { ScheduledTaskService } from '../scheduled/scheduled-task-service.js';
import { TaskScheduler } from '../scheduled/task-scheduler.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('task scheduler', () => {
  it('queues only the latest missed occurrence and advances the next run', async () => {
    let current = new Date('2026-09-16T00:00:00.000Z');
    const now = () => current;
    const database = createDatabase(':memory:');
    const root = mkdtempSync(join(tmpdir(), 'claude-chat-scheduler-'));
    roots.push(root);
    const projects = new ProjectRegistry(database.projects, now);
    const [project] = projects.synchronize([{ displayName: 'Home', path: root }]);
    const events = new EventStore(database.events, new EventStream(), now);
    const tasks = new ScheduledTaskService(database, projects, events, now);
    const runs = new ScheduledRunService(database, events, now);
    const created = tasks.create({
      requestId: 'create-1',
      name: 'Daily',
      prompt: 'Summarize.',
      schedule: { kind: 'daily', hour: 9, minute: 0 },
      timeZone: 'Asia/Shanghai',
      projectId: project!.id,
      allowAutoWrite: false,
    });
    const scheduler = new TaskScheduler(database, runs, tasks, now);

    current = new Date('2026-09-20T03:00:00.000Z');
    await scheduler.tick();

    const history = database.scheduledRuns.listByTask(created.task.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      scheduledFor: '2026-09-20T01:00:00.000Z',
      triggerSource: 'recovery',
      status: 'queued',
    });
    expect(database.scheduledTasks.get(created.task.id)).toMatchObject({
      nextRunAt: '2026-09-21T01:00:00.000Z',
    });
    closeDatabase(database);
  });

  it('records a skipped occurrence when the previous run is still active', async () => {
    let current = new Date('2026-09-16T00:00:00.000Z');
    const now = () => current;
    const database = createDatabase(':memory:');
    const root = mkdtempSync(join(tmpdir(), 'claude-chat-overlap-'));
    roots.push(root);
    const projects = new ProjectRegistry(database.projects, now);
    const [project] = projects.synchronize([{ displayName: 'Home', path: root }]);
    const events = new EventStore(database.events, new EventStream(), now);
    const tasks = new ScheduledTaskService(database, projects, events, now);
    const runs = new ScheduledRunService(database, events, now);
    const task = tasks.create({
      requestId: 'create-2',
      name: 'Daily',
      prompt: 'Summarize.',
      schedule: { kind: 'daily', hour: 9, minute: 0 },
      timeZone: 'Asia/Shanghai',
      projectId: project!.id,
      allowAutoWrite: false,
    }).task;
    runs.queueManual(tasks.getRecord(task.id), 'manual-1');

    current = new Date('2026-09-16T03:00:00.000Z');
    await new TaskScheduler(database, runs, tasks, now).tick();

    expect(
      database.scheduledRuns
        .listByTask(task.id)
        .map((run) => run.status)
        .sort(),
    ).toEqual(['queued', 'skipped']);
    closeDatabase(database);
  });
});
