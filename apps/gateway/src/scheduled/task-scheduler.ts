import type { DatabaseClient } from '@claude-chat/database';
import { scheduleSchema } from '@claude-chat/protocol';

import { latestMissedOccurrence, nextOccurrence } from './schedule-calculator.js';
import type { ScheduledRunService } from './scheduled-run-service.js';
import type { ScheduledTaskService } from './scheduled-task-service.js';

export type TaskSchedulerOptions = {
  intervalMs?: number;
  onError?: (error: unknown) => void;
};

export class TaskScheduler {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  public constructor(
    private readonly database: DatabaseClient,
    private readonly runs: ScheduledRunService,
    private readonly tasks: ScheduledTaskService,
    private readonly now: () => Date = () => new Date(),
    private readonly options: TaskSchedulerOptions = {},
  ) {}

  public start(): () => void {
    if (this.timer) return () => this.stop();
    this.recoverOnStartup();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs ?? 30_000);
    this.timer.unref();
    return () => this.stop();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      this.recoverExpired(now);
      for (const task of this.database.scheduledTasks.listDue(now.toISOString())) {
        const schedule = scheduleSchema.parse(JSON.parse(task.scheduleJson) as unknown);
        const firstDue = new Date(task.nextRunAt!);
        const latest =
          latestMissedOccurrence(schedule, task.timeZone, new Date(firstDue.getTime() - 1), now) ??
          firstDue;
        const trigger = latest.getTime() === firstDue.getTime() ? 'scheduled' : 'recovery';
        this.runs.queueScheduled(task, latest, trigger);

        const next = nextOccurrence(schedule, task.timeZone, now);
        const updated = this.database.scheduledTasks.update(
          task.id,
          { nextRunAt: next?.toISOString() ?? null },
          now.toISOString(),
        );
        if (updated) this.tasks.publishUpdated(updated, null);
      }
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.ticking = false;
    }
  }

  public recoverOnStartup(): number {
    const timestamp = this.now().toISOString();
    const released = this.database.scheduledRuns.releaseAllActive(timestamp);
    for (const run of this.database.scheduledRuns.listQueued()) {
      const task = this.database.scheduledTasks.get(run.taskId);
      if (task && !task.deletedAt) this.runs.dispatch(run, task);
    }
    return released;
  }

  private recoverExpired(now: Date): void {
    const expired = this.database.scheduledRuns.listExpiredLeases(now.toISOString());
    if (expired.length === 0) return;
    this.database.scheduledRuns.releaseExpiredLeases(now.toISOString(), now.toISOString());
    for (const stale of expired) {
      const run = this.database.scheduledRuns.get(stale.id);
      const task = this.database.scheduledTasks.get(stale.taskId);
      if (run?.status === 'queued' && task && !task.deletedAt) {
        this.runs.dispatch(run, task);
      }
    }
  }
}
