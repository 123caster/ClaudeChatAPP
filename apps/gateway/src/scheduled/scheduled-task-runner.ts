import { randomUUID } from 'node:crypto';

import type {
  DatabaseClient,
  ScheduledRunRecord,
  ScheduledTaskRecord,
} from '@claude-chat/database';
import type { EventEnvelope } from '@claude-chat/protocol';

import type { EventStream } from '../events/event-stream.js';
import type { SessionService } from '../sessions/session-service.js';
import { scheduleSchema } from '@claude-chat/protocol';
import { buildScheduledExecutionPrompt } from './scheduled-execution-prompt.js';
import type { ScheduledRunService } from './scheduled-run-service.js';
import type { ScheduledTaskService } from './scheduled-task-service.js';

export type ScheduledTaskRunnerOptions = {
  leaseMs?: number;
  retryDelaysMs?: readonly number[];
  scheduleRetry?: (callback: () => void, delayMs: number) => void;
  onAttention?: (run: ScheduledRunRecord, task: ScheduledTaskRecord) => void | Promise<void>;
  onTerminal?: (run: ScheduledRunRecord, task: ScheduledTaskRecord) => void | Promise<void>;
};

export class ScheduledTaskRunner {
  private readonly workerId = randomUUID();
  private readonly unsubscribe: () => void;

  public constructor(
    private readonly database: DatabaseClient,
    private readonly sessions: SessionService,
    private readonly runs: ScheduledRunService,
    private readonly tasks: ScheduledTaskService,
    eventStream: EventStream,
    private readonly now: () => Date = () => new Date(),
    private readonly options: ScheduledTaskRunnerOptions = {},
  ) {
    this.unsubscribe = eventStream.subscribe((event) => this.handleEvent(event));
  }

  public dispose(): void {
    this.unsubscribe();
  }

  public start(run: ScheduledRunRecord, task: ScheduledTaskRecord): void {
    if (run.status !== 'queued') return;
    const startedAt = this.now();
    const claimed = this.database.scheduledRuns.claim(
      run.id,
      this.workerId,
      new Date(startedAt.getTime() + (this.options.leaseMs ?? 24 * 60 * 60 * 1_000)).toISOString(),
      startedAt.toISOString(),
    );
    if (!claimed) return;

    try {
      const response = this.sessions.runScheduledTask(
        task.sessionId,
        claimed.requestId,
        task.prompt,
        buildScheduledExecutionPrompt(task.prompt, claimed.scheduledFor, task.timeZone),
        task.allowAutoWrite,
      );
      this.runs.transition(claimed.id, {
        userMessageId: response.message.id,
      });
    } catch (error) {
      const failed = this.runs.transition(claimed.id, {
        status: 'failed',
        completedAt: this.now().toISOString(),
        errorCode: 'TASK_START_FAILED',
        errorMessage: error instanceof Error ? error.message.slice(0, 2_000) : 'Task start failed.',
        leaseOwner: null,
        leaseExpiresAt: null,
        notificationStatus: 'pending',
      });
      if (failed) this.completeTask(failed);
    }
  }

  private handleEvent(event: EventEnvelope): void {
    if (!event.requestId) return;
    const run = this.database.scheduledRuns.getByRequestId(event.requestId);
    if (!run || ['succeeded', 'failed', 'skipped', 'cancelled'].includes(run.status)) return;

    if (event.type === 'permission.requested') {
      const waiting = this.runs.transition(run.id, {
        status: 'waiting_permission',
        notificationStatus: 'pending',
      });
      const task = waiting ? this.database.scheduledTasks.get(waiting.taskId) : null;
      if (waiting && task && !task.deletedAt) {
        Promise.resolve(this.options.onAttention?.(waiting, task)).catch(() => undefined);
      }
      return;
    }
    if (event.type === 'session.updated' && event.payload.session.status === 'running') {
      if (run.status === 'waiting_permission') this.runs.transition(run.id, { status: 'running' });
      return;
    }
    if (event.type === 'turn.completed') {
      const completed = this.runs.transition(run.id, {
        status: 'succeeded',
        assistantMessageId: event.payload.assistantMessageId,
        completedAt: this.now().toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        notificationStatus: 'pending',
      });
      if (completed) this.completeTask(completed);
      return;
    }
    if (event.type === 'turn.failed') {
      const retryDelays = this.options.retryDelaysMs ?? [60_000, 5 * 60_000];
      if (
        event.payload.retryable &&
        event.payload.code !== 'TURN_CANCELLED' &&
        run.attemptCount <= retryDelays.length
      ) {
        const queued = this.runs.transition(run.id, {
          status: 'queued',
          errorCode: event.payload.code,
          errorMessage: event.payload.message,
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        if (queued) {
          this.scheduleRetry(queued.id, retryDelays[run.attemptCount - 1] ?? 0);
        }
        return;
      }
      const failed = this.runs.transition(run.id, {
        status: 'failed',
        completedAt: this.now().toISOString(),
        errorCode: event.payload.code,
        errorMessage: event.payload.message,
        leaseOwner: null,
        leaseExpiresAt: null,
        notificationStatus: 'pending',
      });
      if (failed) this.completeTask(failed);
    }
  }

  private scheduleRetry(runId: string, delayMs: number): void {
    const retry = () => {
      const run = this.database.scheduledRuns.get(runId);
      if (run?.status !== 'queued') return;
      const task = this.database.scheduledTasks.get(run.taskId);
      if (task && !task.deletedAt) this.start(run, task);
    };
    if (this.options.scheduleRetry) {
      this.options.scheduleRetry(retry, delayMs);
      return;
    }
    const timer = setTimeout(retry, delayMs);
    timer.unref();
  }

  private completeTask(run: ScheduledRunRecord): void {
    const task = this.database.scheduledTasks.get(run.taskId);
    if (!task || task.deletedAt) return;
    const schedule = scheduleSchema.parse(JSON.parse(task.scheduleJson) as unknown);
    const updated = this.database.scheduledTasks.update(
      task.id,
      {
        lastRunAt: this.now().toISOString(),
        ...(schedule.kind === 'once' && task.nextRunAt === null ? { status: 'completed' } : {}),
      },
      this.now().toISOString(),
    );
    if (updated) this.tasks.publishUpdated(updated, run.requestId);
    if (updated) {
      Promise.resolve(this.options.onTerminal?.(run, updated)).catch(() => undefined);
    }
  }
}
