import type { DatabaseConnection } from '../connection.js';

export const scheduledRunStatuses = [
  'queued',
  'running',
  'waiting_permission',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
] as const;
export type ScheduledRunStatus = (typeof scheduledRunStatuses)[number];
export type ScheduledRunTrigger = 'scheduled' | 'manual' | 'recovery';
export type ScheduledNotificationStatus = 'not_requested' | 'pending' | 'sent' | 'failed';

export type ScheduledRunRecord = {
  id: string;
  taskId: string;
  scheduledFor: string;
  triggerSource: ScheduledRunTrigger;
  status: ScheduledRunStatus;
  requestId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  attemptCount: number;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  notificationStatus: ScheduledNotificationStatus;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateScheduledRunRecord = Omit<ScheduledRunRecord, 'attemptCount'> & {
  attemptCount?: number;
};

export type UpdateScheduledRunRecord = Partial<
  Pick<
    ScheduledRunRecord,
    | 'status'
    | 'userMessageId'
    | 'assistantMessageId'
    | 'startedAt'
    | 'completedAt'
    | 'errorCode'
    | 'errorMessage'
    | 'leaseOwner'
    | 'leaseExpiresAt'
    | 'notificationStatus'
    | 'readAt'
  >
>;

type ScheduledRunRow = {
  id: string;
  task_id: string;
  scheduled_for: string;
  trigger_source: string;
  status: string;
  request_id: string;
  user_message_id: string | null;
  assistant_message_id: string | null;
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  notification_status: string;
  read_at: string | null;
  created_at: string;
  updated_at: string;
};

const runColumns = `
  id, task_id, scheduled_for, trigger_source, status, request_id, user_message_id,
  assistant_message_id, attempt_count, started_at, completed_at, error_code, error_message,
  lease_owner, lease_expires_at, notification_status, read_at, created_at, updated_at`;

function mapRun(row: ScheduledRunRow): ScheduledRunRecord {
  if (!scheduledRunStatuses.includes(row.status as ScheduledRunStatus)) {
    throw new Error(`Unknown scheduled run status: ${row.status}`);
  }
  if (!['scheduled', 'manual', 'recovery'].includes(row.trigger_source)) {
    throw new Error(`Unknown scheduled run trigger: ${row.trigger_source}`);
  }
  if (!['not_requested', 'pending', 'sent', 'failed'].includes(row.notification_status)) {
    throw new Error(`Unknown scheduled notification status: ${row.notification_status}`);
  }

  return {
    id: row.id,
    taskId: row.task_id,
    scheduledFor: row.scheduled_for,
    triggerSource: row.trigger_source as ScheduledRunTrigger,
    status: row.status as ScheduledRunStatus,
    requestId: row.request_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id,
    attemptCount: row.attempt_count,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    notificationStatus: row.notification_status as ScheduledNotificationStatus,
    readAt: row.read_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ScheduledRunRepository {
  get(id: string): ScheduledRunRecord | null;
  getByOccurrence(taskId: string, scheduledFor: string): ScheduledRunRecord | null;
  getByRequestId(requestId: string): ScheduledRunRecord | null;
  listByTask(taskId: string, limit?: number): ScheduledRunRecord[];
  listQueued(): ScheduledRunRecord[];
  listActive(): ScheduledRunRecord[];
  findActiveByTask(taskId: string): ScheduledRunRecord | null;
  listExpiredLeases(now: string): ScheduledRunRecord[];
  create(record: CreateScheduledRunRecord): ScheduledRunRecord;
  claim(
    id: string,
    leaseOwner: string,
    leaseExpiresAt: string,
    startedAt: string,
  ): ScheduledRunRecord | null;
  update(
    id: string,
    changes: UpdateScheduledRunRecord,
    updatedAt: string,
  ): ScheduledRunRecord | null;
  releaseExpiredLeases(now: string, updatedAt: string): number;
  releaseAllActive(updatedAt: string): number;
  markTaskRead(taskId: string, readAt: string): number;
}

class SqliteScheduledRunRepository implements ScheduledRunRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(id: string): ScheduledRunRecord | null {
    const row = this.database
      .prepare(`SELECT ${runColumns} FROM scheduled_runs WHERE id = $id`)
      .get({ $id: id }) as ScheduledRunRow | undefined;
    return row ? mapRun(row) : null;
  }

  public getByOccurrence(taskId: string, scheduledFor: string): ScheduledRunRecord | null {
    const row = this.database
      .prepare(
        `SELECT ${runColumns}
         FROM scheduled_runs
         WHERE task_id = $taskId AND scheduled_for = $scheduledFor`,
      )
      .get({ $scheduledFor: scheduledFor, $taskId: taskId }) as ScheduledRunRow | undefined;
    return row ? mapRun(row) : null;
  }

  public getByRequestId(requestId: string): ScheduledRunRecord | null {
    const row = this.database
      .prepare(`SELECT ${runColumns} FROM scheduled_runs WHERE request_id = $requestId`)
      .get({ $requestId: requestId }) as ScheduledRunRow | undefined;
    return row ? mapRun(row) : null;
  }

  public listByTask(taskId: string, limit = 50): ScheduledRunRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${runColumns}
         FROM scheduled_runs
         WHERE task_id = $taskId
         ORDER BY scheduled_for DESC, id DESC
         LIMIT $limit`,
      )
      .all({ $limit: limit, $taskId: taskId }) as ScheduledRunRow[];
    return rows.map(mapRun);
  }

  public listQueued(): ScheduledRunRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${runColumns}
         FROM scheduled_runs
         WHERE status = 'queued'
         ORDER BY scheduled_for, id`,
      )
      .all() as ScheduledRunRow[];
    return rows.map(mapRun);
  }

  public listActive(): ScheduledRunRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${runColumns}
         FROM scheduled_runs
         WHERE status IN ('running', 'waiting_permission')
         ORDER BY scheduled_for, id`,
      )
      .all() as ScheduledRunRow[];
    return rows.map(mapRun);
  }

  public findActiveByTask(taskId: string): ScheduledRunRecord | null {
    const row = this.database
      .prepare(
        `SELECT ${runColumns}
         FROM scheduled_runs
         WHERE task_id = $taskId
           AND status IN ('queued', 'running', 'waiting_permission')
         LIMIT 1`,
      )
      .get({ $taskId: taskId }) as ScheduledRunRow | undefined;
    return row ? mapRun(row) : null;
  }

  public listExpiredLeases(now: string): ScheduledRunRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${runColumns}
         FROM scheduled_runs
         WHERE status IN ('running', 'waiting_permission')
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= $now
         ORDER BY lease_expires_at, id`,
      )
      .all({ $now: now }) as ScheduledRunRow[];
    return rows.map(mapRun);
  }

  public create(record: CreateScheduledRunRecord): ScheduledRunRecord {
    this.database
      .prepare(
        `INSERT INTO scheduled_runs(
           id, task_id, scheduled_for, trigger_source, status, request_id, user_message_id,
           assistant_message_id, attempt_count, started_at, completed_at, error_code,
           error_message, lease_owner, lease_expires_at, notification_status, read_at,
           created_at, updated_at
         ) VALUES (
           $id, $taskId, $scheduledFor, $triggerSource, $status, $requestId, $userMessageId,
           $assistantMessageId, $attemptCount, $startedAt, $completedAt, $errorCode,
           $errorMessage, $leaseOwner, $leaseExpiresAt, $notificationStatus, $readAt,
           $createdAt, $updatedAt
         )`,
      )
      .run({
        $assistantMessageId: record.assistantMessageId,
        $attemptCount: record.attemptCount ?? 0,
        $completedAt: record.completedAt,
        $createdAt: record.createdAt,
        $errorCode: record.errorCode,
        $errorMessage: record.errorMessage,
        $id: record.id,
        $leaseExpiresAt: record.leaseExpiresAt,
        $leaseOwner: record.leaseOwner,
        $notificationStatus: record.notificationStatus,
        $readAt: record.readAt,
        $requestId: record.requestId,
        $scheduledFor: record.scheduledFor,
        $startedAt: record.startedAt,
        $status: record.status,
        $taskId: record.taskId,
        $triggerSource: record.triggerSource,
        $updatedAt: record.updatedAt,
        $userMessageId: record.userMessageId,
      });
    return this.get(record.id)!;
  }

  public claim(
    id: string,
    leaseOwner: string,
    leaseExpiresAt: string,
    startedAt: string,
  ): ScheduledRunRecord | null {
    const result = this.database
      .prepare(
        `UPDATE scheduled_runs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             started_at = COALESCE(started_at, $startedAt),
             lease_owner = $leaseOwner,
             lease_expires_at = $leaseExpiresAt,
             updated_at = $startedAt
         WHERE id = $id AND status = 'queued'`,
      )
      .run({
        $id: id,
        $leaseExpiresAt: leaseExpiresAt,
        $leaseOwner: leaseOwner,
        $startedAt: startedAt,
      });
    return Number(result.changes) === 1 ? this.get(id) : null;
  }

  public update(
    id: string,
    changes: UpdateScheduledRunRecord,
    updatedAt: string,
  ): ScheduledRunRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    const next = { ...existing, ...changes, updatedAt };
    this.database
      .prepare(
        `UPDATE scheduled_runs
         SET status = $status,
             user_message_id = $userMessageId,
             assistant_message_id = $assistantMessageId,
             started_at = $startedAt,
             completed_at = $completedAt,
             error_code = $errorCode,
             error_message = $errorMessage,
             lease_owner = $leaseOwner,
             lease_expires_at = $leaseExpiresAt,
             notification_status = $notificationStatus,
             read_at = $readAt,
             updated_at = $updatedAt
         WHERE id = $id`,
      )
      .run({
        $assistantMessageId: next.assistantMessageId,
        $completedAt: next.completedAt,
        $errorCode: next.errorCode,
        $errorMessage: next.errorMessage,
        $id: id,
        $leaseExpiresAt: next.leaseExpiresAt,
        $leaseOwner: next.leaseOwner,
        $notificationStatus: next.notificationStatus,
        $readAt: next.readAt,
        $startedAt: next.startedAt,
        $status: next.status,
        $updatedAt: updatedAt,
        $userMessageId: next.userMessageId,
      });
    return this.get(id);
  }

  public releaseExpiredLeases(now: string, updatedAt: string): number {
    const result = this.database
      .prepare(
        `UPDATE scheduled_runs
         SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = $updatedAt
         WHERE status IN ('running', 'waiting_permission')
           AND lease_expires_at IS NOT NULL
           AND lease_expires_at <= $now`,
      )
      .run({ $now: now, $updatedAt: updatedAt });
    return Number(result.changes);
  }

  public releaseAllActive(updatedAt: string): number {
    const result = this.database
      .prepare(
        `UPDATE scheduled_runs
         SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL, updated_at = $updatedAt
         WHERE status IN ('running', 'waiting_permission')`,
      )
      .run({ $updatedAt: updatedAt });
    return Number(result.changes);
  }

  public markTaskRead(taskId: string, readAt: string): number {
    const result = this.database
      .prepare(
        `UPDATE scheduled_runs
         SET read_at = $readAt, updated_at = $readAt
         WHERE task_id = $taskId AND read_at IS NULL`,
      )
      .run({ $readAt: readAt, $taskId: taskId });
    return Number(result.changes);
  }
}

export function createScheduledRunRepository(database: DatabaseConnection): ScheduledRunRepository {
  return new SqliteScheduledRunRepository(database);
}
