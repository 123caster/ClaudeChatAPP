import type { DatabaseConnection } from '../connection.js';

export type ToolCallRecord = {
  id: string;
  sessionId: string;
  toolName: string;
  inputJson: string;
  outputJson: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
};

type ToolCallRow = {
  id: string;
  session_id: string;
  tool_name: string;
  input_json: string;
  output_json: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
};

function mapToolCall(row: ToolCallRow): ToolCallRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    inputJson: row.input_json,
    outputJson: row.output_json,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export interface ToolCallRepository {
  get(id: string): ToolCallRecord | null;
  listBySession(sessionId: string): ToolCallRecord[];
  create(record: ToolCallRecord): ToolCallRecord;
  complete(
    id: string,
    status: string,
    outputJson: string | null,
    completedAt: string,
  ): ToolCallRecord | null;
}

class SqliteToolCallRepository implements ToolCallRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(id: string): ToolCallRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, session_id, tool_name, input_json, output_json, status, created_at,
                completed_at
         FROM tool_calls
         WHERE id = $id`,
      )
      .get({ $id: id }) as ToolCallRow | undefined;
    return row ? mapToolCall(row) : null;
  }

  public listBySession(sessionId: string): ToolCallRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, session_id, tool_name, input_json, output_json, status, created_at,
                completed_at
         FROM tool_calls
         WHERE session_id = $sessionId
         ORDER BY created_at, id`,
      )
      .all({ $sessionId: sessionId }) as ToolCallRow[];
    return rows.map(mapToolCall);
  }

  public create(record: ToolCallRecord): ToolCallRecord {
    this.database
      .prepare(
        `INSERT INTO tool_calls(
           id, session_id, tool_name, input_json, output_json, status, created_at, completed_at
         ) VALUES (
           $id, $sessionId, $toolName, $inputJson, $outputJson, $status, $createdAt, $completedAt
         )`,
      )
      .run({
        $completedAt: record.completedAt,
        $createdAt: record.createdAt,
        $id: record.id,
        $inputJson: record.inputJson,
        $outputJson: record.outputJson,
        $sessionId: record.sessionId,
        $status: record.status,
        $toolName: record.toolName,
      });
    return record;
  }

  public complete(
    id: string,
    status: string,
    outputJson: string | null,
    completedAt: string,
  ): ToolCallRecord | null {
    this.database
      .prepare(
        `UPDATE tool_calls
         SET status = $status, output_json = $outputJson, completed_at = $completedAt
         WHERE id = $id`,
      )
      .run({ $completedAt: completedAt, $id: id, $outputJson: outputJson, $status: status });
    return this.get(id);
  }
}

export function createToolCallRepository(database: DatabaseConnection): ToolCallRepository {
  return new SqliteToolCallRepository(database);
}
