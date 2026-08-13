import type { DatabaseConnection } from '../connection.js';

export type EventRecord = {
  id: number;
  sessionId: string | null;
  requestId: string | null;
  type: string;
  payloadJson: string;
  emittedAt: string;
};

export type AppendEvent = Omit<EventRecord, 'id'>;

type EventRow = {
  id: number;
  session_id: string | null;
  request_id: string | null;
  type: string;
  payload_json: string;
  emitted_at: string;
};

function mapEvent(row: EventRow): EventRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    requestId: row.request_id,
    type: row.type,
    payloadJson: row.payload_json,
    emittedAt: row.emitted_at,
  };
}

export interface EventRepository {
  append(event: AppendEvent): EventRecord;
  listAfter(after: number, limit: number): EventRecord[];
  currentId(): number;
  minimumId(): number;
}

class SqliteEventRepository implements EventRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public append(event: AppendEvent): EventRecord {
    const result = this.database
      .prepare(
        `INSERT INTO events(session_id, request_id, type, payload_json, emitted_at)
         VALUES ($sessionId, $requestId, $type, $payloadJson, $emittedAt)`,
      )
      .run({
        $emittedAt: event.emittedAt,
        $payloadJson: event.payloadJson,
        $requestId: event.requestId,
        $sessionId: event.sessionId,
        $type: event.type,
      });

    return { ...event, id: Number(result.lastInsertRowid) };
  }

  public listAfter(after: number, limit: number): EventRecord[] {
    if (!Number.isSafeInteger(after) || after < 0) {
      throw new RangeError('Event cursor must be a non-negative safe integer.');
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('Event limit must be a positive safe integer.');
    }

    const rows = this.database
      .prepare(
        `SELECT id, session_id, request_id, type, payload_json, emitted_at
         FROM events
         WHERE id > $after
         ORDER BY id
         LIMIT $limit`,
      )
      .all({ $after: after, $limit: limit }) as EventRow[];
    return rows.map(mapEvent);
  }

  public currentId(): number {
    const row = this.database.prepare('SELECT MAX(id) AS id FROM events').get() as {
      id: number | null;
    };
    return row.id ?? 0;
  }

  public minimumId(): number {
    const row = this.database.prepare('SELECT MIN(id) AS id FROM events').get() as {
      id: number | null;
    };
    return row.id ?? 0;
  }
}

export function createEventRepository(database: DatabaseConnection): EventRepository {
  return new SqliteEventRepository(database);
}
