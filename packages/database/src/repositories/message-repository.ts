import type { DatabaseConnection } from '../connection.js';

export type MessageRecord = {
  id: string;
  sessionId: string;
  role: string;
  contentJson: string;
  isPartial: boolean;
  createdAt: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: string;
  content_json: string;
  is_partial: number;
  created_at: string;
};

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    contentJson: row.content_json,
    isPartial: row.is_partial === 1,
    createdAt: row.created_at,
  };
}

export interface MessageRepository {
  get(id: string): MessageRecord | null;
  listBySession(sessionId: string): MessageRecord[];
  create(record: MessageRecord): MessageRecord;
  updateContent(id: string, contentJson: string, isPartial: boolean): MessageRecord | null;
}

class SqliteMessageRepository implements MessageRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(id: string): MessageRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, session_id, role, content_json, is_partial, created_at
         FROM messages
         WHERE id = $id`,
      )
      .get({ $id: id }) as MessageRow | undefined;
    return row ? mapMessage(row) : null;
  }

  public listBySession(sessionId: string): MessageRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, session_id, role, content_json, is_partial, created_at
         FROM messages
         WHERE session_id = $sessionId
         ORDER BY created_at, id`,
      )
      .all({ $sessionId: sessionId }) as MessageRow[];
    return rows.map(mapMessage);
  }

  public create(record: MessageRecord): MessageRecord {
    this.database
      .prepare(
        `INSERT INTO messages(id, session_id, role, content_json, is_partial, created_at)
         VALUES ($id, $sessionId, $role, $contentJson, $isPartial, $createdAt)`,
      )
      .run({
        $contentJson: record.contentJson,
        $createdAt: record.createdAt,
        $id: record.id,
        $isPartial: record.isPartial ? 1 : 0,
        $role: record.role,
        $sessionId: record.sessionId,
      });
    return record;
  }

  public updateContent(id: string, contentJson: string, isPartial: boolean): MessageRecord | null {
    this.database
      .prepare(
        `UPDATE messages
         SET content_json = $contentJson, is_partial = $isPartial
         WHERE id = $id`,
      )
      .run({ $contentJson: contentJson, $id: id, $isPartial: isPartial ? 1 : 0 });
    return this.get(id);
  }
}

export function createMessageRepository(database: DatabaseConnection): MessageRepository {
  return new SqliteMessageRepository(database);
}
