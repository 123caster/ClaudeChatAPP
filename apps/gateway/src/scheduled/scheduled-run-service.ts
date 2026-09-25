import { randomUUID } from 'node:crypto';

import type {
  DatabaseClient,
  ScheduledRunRecord,
  ScheduledRunTrigger,
  ScheduledTaskRecord,
} from '@claude-chat/database';
import type { RunScheduledTaskResponse, ScheduledRun } from '@claude-chat/protocol';

import type { EventStore } from '../events/event-store.js';
import { serializeScheduledRun, serializeScheduledTask } from './serializers.js';

export type QueuedRunHandler = (
  run: ScheduledRunRecord,
  task: ScheduledTaskRecord,
) => void | Promise<void>;

export class ScheduledTaskAlreadyRunningError extends Error {}

export class ScheduledRunService {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly events: EventStore,
    private readonly now: () => Date = () => new Date(),
    private readonly onQueued: QueuedRunHandler = () => undefined,
  ) {}

  public queueManual(task: ScheduledTaskRecord, requestId: string): RunScheduledTaskResponse {
    if (this.database.scheduledRuns.findActiveByTask(task.id)) {
      throw new ScheduledTaskAlreadyRunningError('Scheduled task is already running.');
    }
    const run = this.queue(task, this.now(), 'manual', requestId);
    return { requestId, task: serializeScheduledTask(task), run: serializeScheduledRun(run) };
  }

  public queueScheduled(
    task: ScheduledTaskRecord,
    scheduledFor: Date,
    triggerSource: Exclude<ScheduledRunTrigger, 'manual'>,
  ): ScheduledRunRecord {
    return this.queue(
      task,
      scheduledFor,
      triggerSource,
      `scheduled:${task.id}:${scheduledFor.toISOString()}`,
    );
  }

  public transition(
    runId: string,
    changes: Parameters<DatabaseClient['scheduledRuns']['update']>[1],
  ): ScheduledRunRecord | null {
    const run = this.database.scheduledRuns.update(runId, changes, this.now().toISOString());
    if (!run) return null;
    const serialized = serializeScheduledRun(run);
    this.events.persist({
      sessionId: null,
      requestId: run.requestId,
      type:
        run.status === 'waiting_permission' || run.status === 'failed'
          ? 'scheduled-run.needs-attention'
          : 'scheduled-run.updated',
      payload: { run: serialized },
    });
    return run;
  }

  public dispatch(run: ScheduledRunRecord, task: ScheduledTaskRecord): void {
    Promise.resolve(this.onQueued(run, task)).catch(() => {
      this.transition(run.id, {
        status: 'failed',
        completedAt: this.now().toISOString(),
        errorCode: 'TASK_DISPATCH_FAILED',
        errorMessage: 'Scheduled task could not be dispatched.',
        leaseOwner: null,
        leaseExpiresAt: null,
      });
    });
  }

  private queue(
    task: ScheduledTaskRecord,
    scheduledFor: Date,
    triggerSource: ScheduledRunTrigger,
    requestId: string,
  ): ScheduledRunRecord {
    const scheduledForIso = scheduledFor.toISOString();
    const duplicate = this.database.scheduledRuns.getByOccurrence(task.id, scheduledForIso);
    if (duplicate) return duplicate;

    const timestamp = this.now().toISOString();
    const active = this.database.scheduledRuns.findActiveByTask(task.id);
    const run = this.database.scheduledRuns.create({
      id: randomUUID(),
      taskId: task.id,
      scheduledFor: scheduledForIso,
      triggerSource,
      status: active ? 'skipped' : 'queued',
      requestId,
      userMessageId: null,
      assistantMessageId: null,
      startedAt: null,
      completedAt: active ? timestamp : null,
      errorCode: active ? 'TASK_ALREADY_RUNNING' : null,
      errorMessage: active ? 'Previous scheduled task run is still active.' : null,
      leaseOwner: null,
      leaseExpiresAt: null,
      notificationStatus: 'not_requested',
      readAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.events.persist({
      sessionId: null,
      requestId,
      type: 'scheduled-run.created',
      payload: { run: serializeScheduledRun(run) },
    });
    if (run.status === 'queued') this.dispatch(run, task);
    return run;
  }
}

export function publicScheduledRun(run: ScheduledRunRecord): ScheduledRun {
  return serializeScheduledRun(run);
}
