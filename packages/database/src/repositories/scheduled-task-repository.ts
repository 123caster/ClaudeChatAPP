import type { DatabaseConnection } from '../connection.js';

export const scheduledTaskStatuses = ['active', 'paused', 'completed', 'deleted'] as const;
export type ScheduledTaskStatus = (typeof scheduledTaskStatuses)[number];

export type ScheduledTaskRecord = {
  id: string;
  name: string;
  prompt: string;
  status: ScheduledTaskStatus;
  triggerType: 'time';
  scheduleJson: string;
  timeZone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  sessionId: string;
  projectId: string;
  workingDirectory: string | null;
  modelId: string | null;
  allowAutoWrite: boolean;
  notificationPolicy: 'all_results';
  unreadCount: number;
  needsAttention: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CreateScheduledTaskRecord = Omit<ScheduledTaskRecord, 'unreadCount' | 'needsAttention'>;

export type UpdateScheduledTaskRecord = Partial<
  Pick<
    ScheduledTaskRecord,
    | 'name'
    | 'prompt'
    | 'status'
    | 'scheduleJson'
    | 'timeZone'
    | 'nextRunAt'
    | 'lastRunAt'
    | 'projectId'
    | 'workingDirectory'
    | 'modelId'
    | 'allowAutoWrite'
  >
>;

type ScheduledTaskRow = {
  id: string;
  name: string;
  prompt: string;
  status: string;
  trigger_type: string;
  schedule_json: string;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  session_id: string;
  project_id: string;
  working_directory: string | null;
  model_id: string | null;
  allow_auto_write: number;
  notification_policy: string;
  unread_count: number;
  needs_attention: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

const taskSelect = `
  SELECT t.id, t.name, t.prompt, t.status, t.trigger_type, t.schedule_json, t.timezone,
         t.next_run_at, t.last_run_at, t.session_id, t.project_id, t.working_directory,
         t.model_id, t.allow_auto_write, t.notification_policy, t.created_at, t.updated_at,
         t.deleted_at,
         (
           SELECT COUNT(*)
           FROM scheduled_runs r
           WHERE r.task_id = t.id
             AND r.read_at IS NULL
             AND r.status IN ('waiting_permission', 'succeeded', 'failed', 'skipped', 'cancelled')
         ) AS unread_count,
         EXISTS(
           SELECT 1
           FROM scheduled_runs r
           WHERE r.task_id = t.id
             AND r.status IN ('waiting_permission', 'failed')
             AND r.read_at IS NULL
         ) AS needs_attention
  FROM scheduled_tasks t`;

function mapTask(row: ScheduledTaskRow): ScheduledTaskRecord {
  if (!scheduledTaskStatuses.includes(row.status as ScheduledTaskStatus)) {
    throw new Error(`Unknown scheduled task status: ${row.status}`);
  }
  if (row.trigger_type !== 'time') {
    throw new Error(`Unknown scheduled task trigger: ${row.trigger_type}`);
  }
  if (row.notification_policy !== 'all_results') {
    throw new Error(`Unknown scheduled notification policy: ${row.notification_policy}`);
  }

  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    status: row.status as ScheduledTaskStatus,
    triggerType: 'time',
    scheduleJson: row.schedule_json,
    timeZone: row.timezone,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    sessionId: row.session_id,
    projectId: row.project_id,
    workingDirectory: row.working_directory,
    modelId: row.model_id,
    allowAutoWrite: row.allow_auto_write === 1,
    notificationPolicy: 'all_results',
    unreadCount: Number(row.unread_count),
    needsAttention: row.needs_attention === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export interface ScheduledTaskRepository {
  get(id: string): ScheduledTaskRecord | null;
  list(options?: { includeDeleted?: boolean }): ScheduledTaskRecord[];
  listDue(now: string): ScheduledTaskRecord[];
  create(record: CreateScheduledTaskRecord): ScheduledTaskRecord;
  update(
    id: string,
    changes: UpdateScheduledTaskRecord,
    updatedAt: string,
  ): ScheduledTaskRecord | null;
  softDelete(id: string, deletedAt: string): ScheduledTaskRecord | null;
}

class SqliteScheduledTaskRepository implements ScheduledTaskRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(id: string): ScheduledTaskRecord | null {
    const row = this.database.prepare(`${taskSelect} WHERE t.id = $id`).get({ $id: id }) as
      ScheduledTaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  public list(options: { includeDeleted?: boolean } = {}): ScheduledTaskRecord[] {
    const rows = this.database
      .prepare(
        `${taskSelect}
         WHERE $includeDeleted = 1 OR t.deleted_at IS NULL
         ORDER BY t.updated_at DESC, t.id`,
      )
      .all({ $includeDeleted: options.includeDeleted ? 1 : 0 }) as ScheduledTaskRow[];
    return rows.map(mapTask);
  }

  public listDue(now: string): ScheduledTaskRecord[] {
    const rows = this.database
      .prepare(
        `${taskSelect}
         WHERE t.status = 'active'
           AND t.deleted_at IS NULL
           AND t.next_run_at IS NOT NULL
           AND t.next_run_at <= $now
         ORDER BY t.next_run_at ASC, t.id`,
      )
      .all({ $now: now }) as ScheduledTaskRow[];
    return rows.map(mapTask);
  }

  public create(record: CreateScheduledTaskRecord): ScheduledTaskRecord {
    this.database
      .prepare(
        `INSERT INTO scheduled_tasks(
           id, name, prompt, status, trigger_type, schedule_json, timezone, next_run_at,
           last_run_at, session_id, project_id, working_directory, model_id, allow_auto_write,
           notification_policy, created_at, updated_at, deleted_at
         ) VALUES (
           $id, $name, $prompt, $status, $triggerType, $scheduleJson, $timeZone, $nextRunAt,
           $lastRunAt, $sessionId, $projectId, $workingDirectory, $modelId, $allowAutoWrite,
           $notificationPolicy, $createdAt, $updatedAt, $deletedAt
         )`,
      )
      .run({
        $allowAutoWrite: record.allowAutoWrite ? 1 : 0,
        $createdAt: record.createdAt,
        $deletedAt: record.deletedAt,
        $id: record.id,
        $lastRunAt: record.lastRunAt,
        $modelId: record.modelId,
        $name: record.name,
        $nextRunAt: record.nextRunAt,
        $notificationPolicy: record.notificationPolicy,
        $projectId: record.projectId,
        $prompt: record.prompt,
        $scheduleJson: record.scheduleJson,
        $sessionId: record.sessionId,
        $status: record.status,
        $timeZone: record.timeZone,
        $triggerType: record.triggerType,
        $updatedAt: record.updatedAt,
        $workingDirectory: record.workingDirectory,
      });
    return this.get(record.id)!;
  }

  public update(
    id: string,
    changes: UpdateScheduledTaskRecord,
    updatedAt: string,
  ): ScheduledTaskRecord | null {
    const existing = this.get(id);
    if (!existing || existing.status === 'deleted') return null;
    const next = { ...existing, ...changes, updatedAt };
    this.database
      .prepare(
        `UPDATE scheduled_tasks
         SET name = $name,
             prompt = $prompt,
             status = $status,
             schedule_json = $scheduleJson,
             timezone = $timeZone,
             next_run_at = $nextRunAt,
             last_run_at = $lastRunAt,
             project_id = $projectId,
             working_directory = $workingDirectory,
             model_id = $modelId,
             allow_auto_write = $allowAutoWrite,
             updated_at = $updatedAt
         WHERE id = $id AND deleted_at IS NULL`,
      )
      .run({
        $allowAutoWrite: next.allowAutoWrite ? 1 : 0,
        $id: id,
        $lastRunAt: next.lastRunAt,
        $modelId: next.modelId,
        $name: next.name,
        $nextRunAt: next.nextRunAt,
        $projectId: next.projectId,
        $prompt: next.prompt,
        $scheduleJson: next.scheduleJson,
        $status: next.status,
        $timeZone: next.timeZone,
        $updatedAt: updatedAt,
        $workingDirectory: next.workingDirectory,
      });
    return this.get(id);
  }

  public softDelete(id: string, deletedAt: string): ScheduledTaskRecord | null {
    this.database
      .prepare(
        `UPDATE scheduled_tasks
         SET status = 'deleted', next_run_at = NULL, deleted_at = $deletedAt, updated_at = $deletedAt
         WHERE id = $id AND deleted_at IS NULL`,
      )
      .run({ $deletedAt: deletedAt, $id: id });
    return this.get(id);
  }
}

export function createScheduledTaskRepository(
  database: DatabaseConnection,
): ScheduledTaskRepository {
  return new SqliteScheduledTaskRepository(database);
}
