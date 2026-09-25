import { createHash, randomUUID } from 'node:crypto';

import {
  IdempotencyConflictError,
  type DatabaseClient,
  type ScheduledTaskRecord,
} from '@claude-chat/database';
import {
  type CreateScheduledTaskRequest,
  type CreateScheduledTaskResponse,
  type DeleteScheduledTaskResponse,
  type EventEnvelope,
  type MarkScheduledTaskReadResponse,
  type ScheduledTask,
  type ScheduledTaskDetailResponse,
  type ScheduledTaskDraftRequest,
  type ScheduledTaskDraftResponse,
  type ScheduledTasksResponse,
  type UpdateScheduledTaskRequest,
  type UpdateScheduledTaskResponse,
} from '@claude-chat/protocol';

import type { EventStore } from '../events/event-store.js';
import type { ModelService } from '../models/model-service.js';
import type { ProjectRegistry } from '../projects/project-registry.js';
import { nextOccurrence } from './schedule-calculator.js';
import { parseScheduledTaskDraft } from './schedule-draft-parser.js';
import { serializeScheduledRun, serializeScheduledTask } from './serializers.js';

export class ScheduledTaskNotFoundError extends Error {}
export class ScheduledTaskConfigError extends Error {}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class ScheduledTaskService {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly projects: ProjectRegistry,
    private readonly events: EventStore,
    private readonly now: () => Date = () => new Date(),
    private readonly models?: ModelService,
  ) {}

  public list(): ScheduledTasksResponse {
    return { tasks: this.database.scheduledTasks.list().map(serializeScheduledTask) };
  }

  public detail(taskId: string): ScheduledTaskDetailResponse {
    const task = this.requireTask(taskId);
    return {
      task: serializeScheduledTask(task),
      runs: this.database.scheduledRuns.listByTask(taskId, 100).map(serializeScheduledRun),
    };
  }

  public create(request: CreateScheduledTaskRequest): CreateScheduledTaskResponse {
    this.validateTarget(
      request.projectId,
      request.workingDirectory ?? null,
      request.modelId ?? null,
    );
    const now = this.now();
    const nextRun = nextOccurrence(request.schedule, request.timeZone, now);
    if (!nextRun) throw new ScheduledTaskConfigError('The schedule has no future occurrence.');
    const committedEvents: EventEnvelope[] = [];
    const result = this.database.idempotency.execute<CreateScheduledTaskResponse>(
      {
        requestId: request.requestId,
        operation: 'scheduled-task.create',
        fingerprint: fingerprint(request),
        createdAt: now.toISOString(),
        completedAt: now.toISOString(),
      },
      () => {
        const timestamp = now.toISOString();
        const sessionId = randomUUID();
        this.database.sessions.createScheduled({
          id: sessionId,
          claudeSessionId: null,
          projectId: request.projectId,
          workingDirectory: request.workingDirectory ?? null,
          modelId: request.modelId ?? null,
          title: request.name,
          status: 'idle',
          createdAt: timestamp,
          updatedAt: timestamp,
          archivedAt: null,
        });
        const task = this.database.scheduledTasks.create({
          id: randomUUID(),
          name: request.name,
          prompt: request.prompt,
          status: 'active',
          triggerType: 'time',
          scheduleJson: JSON.stringify(request.schedule),
          timeZone: request.timeZone,
          nextRunAt: nextRun.toISOString(),
          lastRunAt: null,
          sessionId,
          projectId: request.projectId,
          workingDirectory: request.workingDirectory ?? null,
          modelId: request.modelId ?? null,
          allowAutoWrite: request.allowAutoWrite,
          notificationPolicy: 'all_results',
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        });
        const response = { requestId: request.requestId, task: serializeScheduledTask(task) };
        committedEvents.push(
          this.events.append({
            sessionId: null,
            requestId: request.requestId,
            type: 'scheduled-task.created',
            payload: { task: response.task },
          }),
        );
        return response;
      },
    );
    if (!result.replayed) committedEvents.forEach((event) => this.events.publish(event));
    return result.value;
  }

  public update(taskId: string, request: UpdateScheduledTaskRequest): UpdateScheduledTaskResponse {
    const existing = this.requireTask(taskId);
    const current = serializeScheduledTask(existing);
    const projectId = request.projectId ?? current.projectId;
    const workingDirectory =
      request.workingDirectory !== undefined ? request.workingDirectory : current.workingDirectory;
    const modelId = request.modelId !== undefined ? request.modelId : current.modelId;
    this.validateTarget(projectId, workingDirectory, modelId);

    const schedule = request.schedule ?? current.schedule;
    const timeZone = request.timeZone ?? current.timeZone;
    const status = request.status ?? current.status;
    const timestamp = this.now().toISOString();
    const nextRunAt =
      status === 'active'
        ? (nextOccurrence(schedule, timeZone, this.now())?.toISOString() ?? null)
        : null;
    if (status === 'active' && !nextRunAt) {
      throw new ScheduledTaskConfigError('The schedule has no future occurrence.');
    }

    const committedEvents: EventEnvelope[] = [];
    const result = this.database.idempotency.execute<UpdateScheduledTaskResponse>(
      {
        requestId: request.requestId,
        operation: `scheduled-task.update:${taskId}`,
        fingerprint: fingerprint(request),
        createdAt: timestamp,
        completedAt: timestamp,
      },
      () => {
        const updated = this.database.scheduledTasks.update(
          taskId,
          {
            ...(request.name !== undefined ? { name: request.name } : {}),
            ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
            status,
            scheduleJson: JSON.stringify(schedule),
            timeZone,
            nextRunAt,
            projectId,
            workingDirectory,
            modelId,
            ...(request.allowAutoWrite !== undefined
              ? { allowAutoWrite: request.allowAutoWrite }
              : {}),
          },
          timestamp,
        );
        if (!updated) throw new ScheduledTaskNotFoundError('Scheduled task not found.');
        this.database.sessions.updateTitle(updated.sessionId, updated.name, timestamp);
        this.database.sessions.updateContext(
          updated.sessionId,
          updated.projectId,
          updated.workingDirectory,
          updated.modelId,
          timestamp,
        );
        const response = { requestId: request.requestId, task: serializeScheduledTask(updated) };
        committedEvents.push(
          this.events.append({
            sessionId: null,
            requestId: request.requestId,
            type: 'scheduled-task.updated',
            payload: { task: response.task },
          }),
        );
        return response;
      },
    );
    if (!result.replayed) committedEvents.forEach((event) => this.events.publish(event));
    return result.value;
  }

  public delete(taskId: string, requestId: string): DeleteScheduledTaskResponse {
    const timestamp = this.now().toISOString();
    const committedEvents: EventEnvelope[] = [];
    const result = this.database.idempotency.execute<DeleteScheduledTaskResponse>(
      {
        requestId,
        operation: `scheduled-task.delete:${taskId}`,
        fingerprint: fingerprint({ requestId }),
        createdAt: timestamp,
        completedAt: timestamp,
      },
      () => {
        this.requireTask(taskId);
        if (!this.database.scheduledTasks.softDelete(taskId, timestamp)) {
          throw new ScheduledTaskNotFoundError('Scheduled task not found.');
        }
        const response = { requestId, taskId };
        committedEvents.push(
          this.events.append({
            sessionId: null,
            requestId,
            type: 'scheduled-task.deleted',
            payload: { taskId },
          }),
        );
        return response;
      },
    );
    if (!result.replayed) committedEvents.forEach((event) => this.events.publish(event));
    return result.value;
  }

  public markRead(taskId: string, requestId: string): MarkScheduledTaskReadResponse {
    this.requireTask(taskId);
    const timestamp = this.now().toISOString();
    const result = this.database.idempotency.execute<MarkScheduledTaskReadResponse>(
      {
        requestId,
        operation: `scheduled-task.read:${taskId}`,
        fingerprint: fingerprint({ requestId }),
        createdAt: timestamp,
        completedAt: timestamp,
      },
      () => {
        this.database.scheduledRuns.markTaskRead(taskId, timestamp);
        return { requestId, task: serializeScheduledTask(this.requireTask(taskId)) };
      },
    );
    if (!result.replayed) {
      this.events.persist({
        sessionId: null,
        requestId,
        type: 'scheduled-task.updated',
        payload: { task: result.value.task },
      });
    }
    return result.value;
  }

  public draft(request: ScheduledTaskDraftRequest): ScheduledTaskDraftResponse {
    return {
      requestId: request.requestId,
      draft: parseScheduledTaskDraft(request),
    };
  }

  public getRecord(taskId: string): ScheduledTaskRecord {
    return this.requireTask(taskId);
  }

  public publishUpdated(record: ScheduledTaskRecord, requestId: string | null): ScheduledTask {
    const task = serializeScheduledTask(record);
    this.events.persist({
      sessionId: null,
      requestId,
      type: 'scheduled-task.updated',
      payload: { task },
    });
    return task;
  }

  private requireTask(taskId: string): ScheduledTaskRecord {
    const task = this.database.scheduledTasks.get(taskId);
    if (!task || task.deletedAt) throw new ScheduledTaskNotFoundError('Scheduled task not found.');
    return task;
  }

  private validateTarget(
    projectId: string,
    workingDirectory: string | null,
    modelId: string | null,
  ): void {
    this.projects.resolveForExecution(projectId, workingDirectory);
    if (modelId && !this.models?.get(modelId)) {
      throw new ScheduledTaskConfigError('Selected model is unavailable.');
    }
  }
}

export { IdempotencyConflictError };
