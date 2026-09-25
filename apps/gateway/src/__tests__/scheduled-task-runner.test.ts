import { closeDatabase, createDatabase, type DatabaseClient } from '@claude-chat/database';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeClaudeAdapter } from '../claude/fake-claude-adapter.js';
import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { ScheduledRunService } from '../scheduled/scheduled-run-service.js';
import { ScheduledTaskRunner } from '../scheduled/scheduled-task-runner.js';
import { ScheduledTaskService } from '../scheduled/scheduled-task-service.js';
import { SessionService } from '../sessions/session-service.js';

type Context = {
  adapter: FakeClaudeAdapter;
  database: DatabaseClient;
  root: string;
  runner: ScheduledTaskRunner;
  runs: ScheduledRunService;
  sessions: SessionService;
  tasks: ScheduledTaskService;
};

const contexts: Context[] = [];

function createContext(
  allowAutoWrite: boolean,
  runnerOptions: ConstructorParameters<typeof ScheduledTaskRunner>[6] = {},
): Context & { taskId: string } {
  const database = createDatabase(':memory:');
  const root = mkdtempSync(join(tmpdir(), 'scheduled-runner-'));
  mkdirSync(join(root, 'reports'));
  const now = () => new Date();
  const projects = new ProjectRegistry(database.projects, now);
  const [project] = projects.synchronize([{ displayName: 'Home', path: root }]);
  const stream = new EventStream();
  const events = new EventStore(database.events, stream, now);
  const adapter = new FakeClaudeAdapter();
  const sessions = new SessionService(database, projects, adapter, events, now);
  const tasks = new ScheduledTaskService(database, projects, events, now);
  const runnerRef: { current: ScheduledTaskRunner | null } = { current: null };
  const runs = new ScheduledRunService(database, events, now, (run, task) => {
    if (!runnerRef.current) throw new Error('Scheduled task runner is unavailable.');
    runnerRef.current.start(run, task);
  });
  const runner = new ScheduledTaskRunner(
    database,
    sessions,
    runs,
    tasks,
    stream,
    now,
    runnerOptions,
  );
  runnerRef.current = runner;
  const task = tasks.create({
    requestId: `create-${allowAutoWrite}`,
    name: 'Daily',
    prompt: 'Create a report.',
    schedule: { kind: 'daily', hour: 23, minute: 59 },
    timeZone: 'UTC',
    projectId: project!.id,
    allowAutoWrite,
  }).task;
  const context = { adapter, database, root, runner, runs, sessions, tasks };
  contexts.push(context);
  return { ...context, taskId: task.id };
}

afterEach(() => {
  for (const context of contexts.splice(0)) {
    context.runner.dispose();
    closeDatabase(context.database);
    rmSync(context.root, { recursive: true, force: true });
  }
});

async function waitForRun(database: DatabaseClient, taskId: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (database.scheduledRuns.listByTask(taskId)[0]?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Run did not reach ${status}.`);
}

describe('scheduled task runner', () => {
  it('executes a queued run through the existing durable session pipeline', async () => {
    const context = createContext(false);
    context.adapter.enqueue([
      { type: 'delta', text: 'Done' },
      { type: 'complete_message', text: 'Done' },
      { type: 'complete_turn' },
    ]);

    context.runs.queueManual(context.tasks.getRecord(context.taskId), 'manual-run-1');
    await waitForRun(context.database, context.taskId, 'succeeded');

    const run = context.database.scheduledRuns.listByTask(context.taskId)[0]!;
    const task = context.database.scheduledTasks.get(context.taskId)!;
    expect(run).toMatchObject({
      userMessageId: expect.any(String),
      assistantMessageId: expect.any(String),
    });
    const messages = context.database.messages.listBySession(task.sessionId);
    expect(messages).toHaveLength(2);
    expect(JSON.parse(messages[0]!.contentJson)).toEqual({ text: 'Create a report.' });
    expect(context.adapter.requests[0]!.prompt).not.toBe('Create a report.');
    expect(context.adapter.requests[0]!.prompt).toContain('已经到达执行时间');
    expect(context.adapter.requests[0]!.prompt).toContain('不要创建、修改、查看或解释任何定时任务');
    expect(context.adapter.requests[0]!.prompt).toContain('仅可用 curl -s');
    expect(context.adapter.requests[0]!.prompt).toContain('不得使用其他 Bash/Shell 命令');
    expect(context.adapter.requests[0]!.prompt).toContain('只返回本次执行产生的实际结果');
    expect(context.adapter.requests[0]!.prompt).toContain('Create a report.');
    expect(context.database.sessions.list()).toEqual([]);
  });

  it('auto-allows an in-workspace Write only when the task switch is enabled', async () => {
    const context = createContext(true);
    context.adapter.enqueue([
      {
        type: 'permission',
        request: {
          toolCallId: 'write-1',
          toolName: 'Write',
          input: { file_path: 'reports/today.md' },
        },
      },
      { type: 'complete_message', text: 'Written' },
      { type: 'complete_turn' },
    ]);

    context.runs.queueManual(context.tasks.getRecord(context.taskId), 'manual-write-1');
    await waitForRun(context.database, context.taskId, 'succeeded');
    expect(context.database.permissions.listUnresolved()).toEqual([]);
  });

  it('keeps Bash behind phone approval even when auto write is enabled', async () => {
    const context = createContext(true);
    context.adapter.enqueue([
      {
        type: 'permission',
        request: {
          toolCallId: 'bash-1',
          toolName: 'Bash',
          input: { command: 'echo hello' },
        },
      },
      { type: 'complete_message', text: 'Approved' },
      { type: 'complete_turn' },
    ]);

    context.runs.queueManual(context.tasks.getRecord(context.taskId), 'manual-bash-1');
    await waitForRun(context.database, context.taskId, 'waiting_permission');
    const [permission] = context.database.permissions.listUnresolved();
    expect(permission).toBeDefined();
    context.sessions.decidePermission(permission!.id, {
      requestId: 'approve-bash-1',
      decision: 'allow_once',
    });
    await waitForRun(context.database, context.taskId, 'succeeded');
  });

  it('retries a transient failure without duplicating the task message', async () => {
    const context = createContext(false, {
      retryDelaysMs: [0],
      scheduleRetry: (callback) => setTimeout(callback, 0),
    });
    context.adapter.enqueue([{ type: 'fail', message: 'Temporary provider failure.' }]);
    context.adapter.enqueue([
      { type: 'complete_message', text: 'Recovered' },
      { type: 'complete_turn' },
    ]);

    context.runs.queueManual(context.tasks.getRecord(context.taskId), 'manual-retry-1');
    await waitForRun(context.database, context.taskId, 'succeeded');

    const run = context.database.scheduledRuns.listByTask(context.taskId)[0]!;
    const task = context.database.scheduledTasks.get(context.taskId)!;
    expect(run.attemptCount).toBe(2);
    expect(context.adapter.requests).toHaveLength(2);
    expect(context.database.messages.listBySession(task.sessionId)).toHaveLength(2);
  });
});
