import { closeDatabase, createDatabase, type DatabaseClient } from '@claude-chat/database';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ModelService } from '../models/model-service.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { ScheduledRunService } from '../scheduled/scheduled-run-service.js';
import { ScheduledTaskService } from '../scheduled/scheduled-task-service.js';

type TestContext = {
  app: FastifyInstance;
  database: DatabaseClient;
  projectId: string;
  root: string;
};

const contexts: TestContext[] = [];

function createContext(): TestContext {
  const database = createDatabase(':memory:');
  const root = mkdtempSync(join(tmpdir(), 'claude-chat-scheduled-'));
  const now = () => new Date('2026-09-16T00:00:00.000Z');
  const projects = new ProjectRegistry(database.projects, now);
  const [project] = projects.synchronize([{ displayName: 'Home', path: root }]);
  const eventStream = new EventStream();
  const events = new EventStore(database.events, eventStream, now);
  const models = new ModelService(database.models, now, database.sessions);
  const tasks = new ScheduledTaskService(database, projects, events, now, models);
  const runs = new ScheduledRunService(database, events, now);
  const app = buildApp({
    services: { projects, models, scheduledTasks: tasks, scheduledRuns: runs },
  });
  const context = { app, database, projectId: project!.id, root };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.app.close();
    closeDatabase(context.database);
    rmSync(context.root, { recursive: true, force: true });
  }
});

function createPayload(projectId: string) {
  return {
    requestId: 'create-task-1',
    name: '每日摘要',
    prompt: '总结项目进展。',
    schedule: { kind: 'daily', hour: 9, minute: 0 },
    timeZone: 'Asia/Shanghai',
    projectId,
    allowAutoWrite: false,
  };
}

describe('scheduled task routes', () => {
  it('creates a task with a hidden dedicated session and lists its detail', async () => {
    const context = createContext();
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      payload: createPayload(context.projectId),
    });

    expect(created.statusCode).toBe(201);
    const task = (created.json() as { task: { id: string; sessionId: string; nextRunAt: string } })
      .task;
    expect(task.nextRunAt).toBe('2026-09-16T01:00:00.000Z');
    expect(context.database.sessions.isScheduled(task.sessionId)).toBe(true);
    expect(context.database.sessions.list()).toEqual([]);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/v1/scheduled-tasks/${task.id}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ task: { name: '每日摘要' }, runs: [] });
  });

  it('updates, pauses, marks read and soft-deletes a task idempotently', async () => {
    const context = createContext();
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      payload: createPayload(context.projectId),
    });
    const taskId = (created.json() as { task: { id: string } }).task.id;

    const updated = await context.app.inject({
      method: 'POST',
      url: `/v1/scheduled-tasks/${taskId}/update`,
      payload: { requestId: 'pause-task-1', name: '暂停的摘要', status: 'paused' },
    });
    expect(updated.json()).toMatchObject({
      task: { name: '暂停的摘要', status: 'paused', nextRunAt: null },
    });
    expect(
      context.database.sessions.get(
        (updated.json() as { task: { sessionId: string } }).task.sessionId,
      ),
    ).toMatchObject({ title: '暂停的摘要' });

    const deleted = await context.app.inject({
      method: 'POST',
      url: `/v1/scheduled-tasks/${taskId}/delete`,
      payload: { requestId: 'delete-task-1' },
    });
    expect(deleted.statusCode).toBe(200);
    const replay = await context.app.inject({
      method: 'POST',
      url: `/v1/scheduled-tasks/${taskId}/delete`,
      payload: { requestId: 'delete-task-1' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(deleted.json());
    expect(
      (await context.app.inject({ method: 'GET', url: '/v1/scheduled-tasks' })).json(),
    ).toEqual({
      tasks: [],
    });
  });

  it('returns a confirmable draft and does not create it automatically', async () => {
    const context = createContext();
    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks/draft',
      payload: {
        requestId: 'draft-1',
        text: '/schedule 每个工作日早上9点总结项目进展',
        timeZone: 'Asia/Shanghai',
        projectId: context.projectId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      draft: {
        schedule: { kind: 'weekdays', hour: 9, minute: 0 },
        allowAutoWrite: false,
        missingFields: [],
      },
    });
    expect(context.database.scheduledTasks.list()).toEqual([]);
  });

  it('rejects invalid project paths and overlapping manual runs', async () => {
    const context = createContext();
    const invalid = await context.app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      payload: { ...createPayload(context.projectId), workingDirectory: '../outside' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'PROJECT_PATH_INVALID' } });

    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/scheduled-tasks',
      payload: { ...createPayload(context.projectId), requestId: 'create-task-2' },
    });
    const taskId = (created.json() as { task: { id: string } }).task.id;
    const first = await context.app.inject({
      method: 'POST',
      url: `/v1/scheduled-tasks/${taskId}/run`,
      payload: { requestId: 'manual-run-1' },
    });
    expect(first.statusCode).toBe(202);
    const second = await context.app.inject({
      method: 'POST',
      url: `/v1/scheduled-tasks/${taskId}/run`,
      payload: { requestId: 'manual-run-2' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'TASK_ALREADY_RUNNING' } });
  });
});
