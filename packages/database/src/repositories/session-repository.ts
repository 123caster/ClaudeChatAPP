import type { DatabaseConnection } from '../connection.js';

export const sessionStatuses = [
  'idle',
  'running',
  'waiting_permission',
  'interrupted',
  'error',
  'archived',
] as const;

export type SessionStatus = (typeof sessionStatuses)[number];

export type SessionRecord = {
  id: string;
  claudeSessionId: string | null;
  projectId: string;
  workingDirectory?: string | null;
  modelId?: string | null;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type SessionListOptions = {
  includeArchived?: boolean;
  includeScheduled?: boolean;
};

type SessionRow = {
  id: string;
  claude_session_id: string | null;
  project_id: string;
  working_directory: string | null;
  model_id: string | null;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

function mapSession(row: SessionRow): SessionRecord {
  if (!sessionStatuses.includes(row.status as SessionStatus)) {
    throw new Error(`Unknown session status: ${row.status}`);
  }

  return {
    id: row.id,
    claudeSessionId: row.claude_session_id,
    projectId: row.project_id,
    workingDirectory: row.working_directory,
    modelId: row.model_id,
    title: row.title,
    status: row.status as SessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export interface SessionRepository {
  get(id: string): SessionRecord | null;
  list(options?: SessionListOptions): SessionRecord[];
  create(record: SessionRecord): SessionRecord;
  createScheduled(record: SessionRecord): SessionRecord;
  isScheduled(id: string): boolean;
  updateStatus(id: string, status: SessionStatus, updatedAt: string): SessionRecord | null;
  updateTitle(id: string, title: string, updatedAt: string): SessionRecord | null;
  updateContext(
    id: string,
    projectId: string,
    workingDirectory: string | null,
    modelId: string | null,
    updatedAt: string,
  ): SessionRecord | null;
  setModel(id: string, modelId: string | null, updatedAt: string): SessionRecord | null;
  interrupt(id: string, reason: 'cancelled' | 'failed', updatedAt: string): SessionRecord | null;
  canResumeInterrupted(id: string): boolean;
  updateClaudeSessionId(
    id: string,
    claudeSessionId: string | null,
    updatedAt: string,
  ): SessionRecord | null;
  resetConversation(id: string, updatedAt: string): SessionRecord | null;
  recoverInterrupted(updatedAt: string): number;
  archive(id: string, archivedAt: string): SessionRecord | null;
  delete(id: string): boolean;
}

class SqliteSessionRepository implements SessionRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(id: string): SessionRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, claude_session_id, project_id, working_directory, model_id, title, status, created_at, updated_at,
                archived_at
         FROM sessions
         WHERE id = $id`,
      )
      .get({ $id: id }) as SessionRow | undefined;
    return row ? mapSession(row) : null;
  }

  public list(options: SessionListOptions = {}): SessionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, claude_session_id, project_id, working_directory, model_id, title, status, created_at, updated_at,
                archived_at
         FROM sessions
         WHERE ($includeArchived = 1 OR archived_at IS NULL)
           AND ($includeScheduled = 1 OR kind = 'chat')
         ORDER BY updated_at DESC, id`,
      )
      .all({
        $includeArchived: options.includeArchived ? 1 : 0,
        $includeScheduled: options.includeScheduled ? 1 : 0,
      }) as SessionRow[];
    return rows.map(mapSession);
  }

  public create(record: SessionRecord): SessionRecord {
    return this.createWithKind(record, 'chat');
  }

  public createScheduled(record: SessionRecord): SessionRecord {
    return this.createWithKind(record, 'scheduled');
  }

  public isScheduled(id: string): boolean {
    const row = this.database
      .prepare(`SELECT kind FROM sessions WHERE id = $id`)
      .get({ $id: id }) as { kind: string } | undefined;
    return row?.kind === 'scheduled';
  }

  private createWithKind(record: SessionRecord, kind: 'chat' | 'scheduled'): SessionRecord {
    this.database
      .prepare(
        `INSERT INTO sessions(
           id, claude_session_id, project_id, working_directory, model_id, title, status, created_at, updated_at, archived_at, kind
         ) VALUES (
           $id, $claudeSessionId, $projectId, $workingDirectory, $modelId, $title, $status, $createdAt, $updatedAt, $archivedAt, $kind
         )`,
      )
      .run({
        $archivedAt: record.archivedAt,
        $claudeSessionId: record.claudeSessionId,
        $createdAt: record.createdAt,
        $id: record.id,
        $kind: kind,
        $modelId: record.modelId ?? null,
        $projectId: record.projectId,
        $workingDirectory: record.workingDirectory ?? null,
        $status: record.status,
        $title: record.title,
        $updatedAt: record.updatedAt,
      });
    return record;
  }

  public updateStatus(id: string, status: SessionStatus, updatedAt: string): SessionRecord | null {
    this.database
      .prepare(
        `UPDATE sessions
         SET status = $status,
             updated_at = $updatedAt,
             interruption_reason = CASE WHEN $status = 'interrupted' THEN interruption_reason ELSE NULL END
         WHERE id = $id`,
      )
      .run({ $id: id, $status: status, $updatedAt: updatedAt });
    return this.get(id);
  }

  public updateTitle(id: string, title: string, updatedAt: string): SessionRecord | null {
    this.database
      .prepare(
        `UPDATE sessions
         SET title = $title, updated_at = $updatedAt
         WHERE id = $id`,
      )
      .run({ $id: id, $title: title, $updatedAt: updatedAt });
    return this.get(id);
  }

  public updateContext(
    id: string,
    projectId: string,
    workingDirectory: string | null,
    modelId: string | null,
    updatedAt: string,
  ): SessionRecord | null {
    this.database
      .prepare(
        `UPDATE sessions
         SET project_id = $projectId,
             working_directory = $workingDirectory,
             model_id = $modelId,
             updated_at = $updatedAt
         WHERE id = $id`,
      )
      .run({
        $id: id,
        $modelId: modelId,
        $projectId: projectId,
        $updatedAt: updatedAt,
        $workingDirectory: workingDirectory,
      });
    return this.get(id);
  }

  public setModel(id: string, modelId: string | null, updatedAt: string): SessionRecord | null {
    this.database
      .prepare(
        `UPDATE sessions
         SET model_id = $modelId, updated_at = $updatedAt
         WHERE id = $id`,
      )
      .run({ $id: id, $modelId: modelId, $updatedAt: updatedAt });
    return this.get(id);
  }

  public interrupt(
    id: string,
    reason: 'cancelled' | 'failed',
    updatedAt: string,
  ): SessionRecord | null {
    this.database
      .prepare(
        `UPDATE sessions
         SET status = 'interrupted', interruption_reason = $reason, updated_at = $updatedAt
         WHERE id = $id`,
      )
      .run({ $id: id, $reason: reason, $updatedAt: updatedAt });
    return this.get(id);
  }

  public canResumeInterrupted(id: string): boolean {
    const row = this.database
      .prepare(
        `SELECT 1 AS resumable
         FROM sessions
         WHERE id = $id
           AND status = 'interrupted'
           AND (interruption_reason = 'restart' OR interruption_reason IS NULL)`,
      )
      .get({ $id: id }) as { resumable: number } | undefined;
    return row?.resumable === 1;
  }

  public updateClaudeSessionId(
    id: string,
    claudeSessionId: string | null,
    updatedAt: string,
  ): SessionRecord | null {
    this.database
      .prepare(
        `UPDATE sessions
         SET claude_session_id = $claudeSessionId, updated_at = $updatedAt
         WHERE id = $id`,
      )
      .run({ $claudeSessionId: claudeSessionId, $id: id, $updatedAt: updatedAt });
    return this.get(id);
  }

  public resetConversation(id: string, updatedAt: string): SessionRecord | null {
    this.database
      .prepare(
        `UPDATE sessions
         SET claude_session_id = NULL,
             status = 'idle',
             interruption_reason = NULL,
             updated_at = $updatedAt
         WHERE id = $id AND archived_at IS NULL`,
      )
      .run({ $id: id, $updatedAt: updatedAt });
    return this.get(id);
  }

  public recoverInterrupted(updatedAt: string): number {
    const result = this.database
      .prepare(
        `UPDATE sessions
         SET status = 'interrupted', interruption_reason = 'restart', updated_at = $updatedAt
         WHERE status IN ('running', 'waiting_permission') AND archived_at IS NULL`,
      )
      .run({ $updatedAt: updatedAt });
    return Number(result.changes);
  }

  public archive(id: string, archivedAt: string): SessionRecord | null {
    this.database
      .prepare(
        `UPDATE sessions
         SET status = 'archived', updated_at = $archivedAt, archived_at = $archivedAt
         WHERE id = $id`,
      )
      .run({ $archivedAt: archivedAt, $id: id });
    return this.get(id);
  }

  public delete(id: string): boolean {
    // Related rows (messages, tool_calls, permission_requests, events) cascade
    // via their foreign-key ON DELETE CASCADE clauses.
    const result = this.database.prepare('DELETE FROM sessions WHERE id = $id').run({ $id: id });
    return result.changes === 1 || result.changes === 1n;
  }
}

export function createSessionRepository(database: DatabaseConnection): SessionRepository {
  return new SqliteSessionRepository(database);
}
