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
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type SessionListOptions = {
  includeArchived?: boolean;
};

type SessionRow = {
  id: string;
  claude_session_id: string | null;
  project_id: string;
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
  updateStatus(id: string, status: SessionStatus, updatedAt: string): SessionRecord | null;
  updateClaudeSessionId(
    id: string,
    claudeSessionId: string | null,
    updatedAt: string,
  ): SessionRecord | null;
  recoverInterrupted(updatedAt: string): number;
  archive(id: string, archivedAt: string): SessionRecord | null;
}

class SqliteSessionRepository implements SessionRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(id: string): SessionRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, claude_session_id, project_id, title, status, created_at, updated_at,
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
        `SELECT id, claude_session_id, project_id, title, status, created_at, updated_at,
                archived_at
         FROM sessions
         WHERE $includeArchived = 1 OR archived_at IS NULL
         ORDER BY updated_at DESC, id`,
      )
      .all({ $includeArchived: options.includeArchived ? 1 : 0 }) as SessionRow[];
    return rows.map(mapSession);
  }

  public create(record: SessionRecord): SessionRecord {
    this.database
      .prepare(
        `INSERT INTO sessions(
           id, claude_session_id, project_id, title, status, created_at, updated_at, archived_at
         ) VALUES (
           $id, $claudeSessionId, $projectId, $title, $status, $createdAt, $updatedAt, $archivedAt
         )`,
      )
      .run({
        $archivedAt: record.archivedAt,
        $claudeSessionId: record.claudeSessionId,
        $createdAt: record.createdAt,
        $id: record.id,
        $projectId: record.projectId,
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
         SET status = $status, updated_at = $updatedAt
         WHERE id = $id`,
      )
      .run({ $id: id, $status: status, $updatedAt: updatedAt });
    return this.get(id);
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

  public recoverInterrupted(updatedAt: string): number {
    const result = this.database
      .prepare(
        `UPDATE sessions
         SET status = 'interrupted', updated_at = $updatedAt
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
}

export function createSessionRepository(database: DatabaseConnection): SessionRepository {
  return new SqliteSessionRepository(database);
}
