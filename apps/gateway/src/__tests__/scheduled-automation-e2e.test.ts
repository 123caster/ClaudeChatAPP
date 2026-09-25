import { closeDatabase, createDatabase, type DatabaseClient } from '@claude-chat/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { FakeClaudeAdapter } from '../claude/fake-claude-adapter.js';
import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { ScheduledRunService } from '../scheduled/scheduled-run-service.js';
import { ScheduledTaskRunner } from '../scheduled/scheduled-task-runner.js';
import { ScheduledTaskService } from '../scheduled/scheduled-task-service.js';
import { TaskScheduler } from '../scheduled/task-scheduler.js';
import { SessionService } from '../sessions/session-service.js';

type Context = {
  app: FastifyInstance;
  database: DatabaseClient;
  root: string;
  runner: ScheduledTaskRunner;
};

const contexts: Context[] = [];

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.runner.dispose();
    await context.app.close();
    closeDatabase(context.database);
    rmSync(context.root, { recursive: true, force: true });
  }
});

async function waitForTerminal(database: DatabaseClient, taskId: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (database.scheduledRuns.listByTask(taskId)[0]?.status === 'succeeded') return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Scheduled run did not complete.');
}

describe('scheduled automation end to end', () => {
  it('creates through HTTP and runs a due task in its hidden conversation', async () => {
    let currentTime = new Date('2026-09-17T00:00:00.000Z');
    const now = () => currentTime;
    const database = createDatabase(':memory:');
    const root = mkdtempSync(join(tmpdir(), 'scheduled-e2e-'));
    const projects = new ProjectRegistry(database.projects, now);
    const [project] = projects.synchronize([{ displayName: 'Home', path: root }]);
    const stream = new EventStream();
    const events = new EventStore(database.events, stream, now);
    const adapter = new FakeClaudeAdapter();
    adapter.enqueue([
      { type: 'complete_message', text: 'Two-minute task finished.' },
      { type: 'complete_turn' },
    ]);
    const sessions = new SessionService(database, projects, adapter, events, now);
    const tasks = new ScheduledTaskService(database, projects, events, now);
    const runnerRef: { current: ScheduledTaskRunner | null } = { current: null };
    const runs = new ScheduledRunService(database, events, now, (run, task) => {
      if (!runnerRef.current) throw new Error('Scheduled task runner is unavailable.');
      runnerRef.current.start(run, task);
    });
    const runner = new ScheduledTaskRunner(database, sessions, runs, tasks, stream, now, {
      retryDelaysMs: [],
    });
    runnerRef.current = runner;
    const scheduler = new TaskScheduler(database, runs, tasks, now);
    const app = buildApp({
      services: { projects, sessions, scheduledTasks: tasks, scheduledRuns: runs },
    });
    contexts.push({ app, database, root, runner });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      payload: {
        requestId: 'e2e-create-1',
        name: 'Two minute check',
        prompt: 'Finish the scheduled check.',
        schedule: { kind: 'once', localDate: '2026-09-17', hour: 0, minute: 2 },
        timeZone: 'UTC',
        projectId: project!.id,
        allowAutoWrite: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const task = (created.json() as { task: { id: string; sessionId: string; nextRunAt: string } })
      .task;
    expect(task.nextRunAt).toBe('2026-09-17T00:02:00.000Z');

    currentTime = new Date('2026-09-17T00:02:01.000Z');
    await scheduler.tick();
    await waitForTerminal(database, task.id);

    expect(database.scheduledRuns.listByTask(task.id)[0]).toMatchObject({
      status: 'succeeded',
      attemptCount: 1,
    });
    expect(database.messages.listBySession(task.sessionId).map(({ role }) => role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(database.sessions.list()).toEqual([]);
  });
});
