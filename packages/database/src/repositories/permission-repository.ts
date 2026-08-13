import type { DatabaseConnection } from '../connection.js';

export const permissionDecisions = ['allow_once', 'deny', 'cancelled'] as const;

export type PermissionDecision = (typeof permissionDecisions)[number];

export type PermissionRecord = {
  id: string;
  sessionId: string;
  toolCallId: string | null;
  requestJson: string;
  decision: PermissionDecision | null;
  decisionMessage: string | null;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
};

export type PermissionDecisionResult =
  | { status: 'decided'; permission: PermissionRecord }
  | { status: 'not_found' }
  | { status: 'already_resolved'; permission: PermissionRecord }
  | { status: 'expired'; permission: PermissionRecord };

type PermissionRow = {
  id: string;
  session_id: string;
  tool_call_id: string | null;
  request_json: string;
  decision: string | null;
  decision_message: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
};

function mapPermission(row: PermissionRow): PermissionRecord {
  if (row.decision !== null && !permissionDecisions.includes(row.decision as PermissionDecision)) {
    throw new Error(`Unknown permission decision: ${row.decision}`);
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    toolCallId: row.tool_call_id,
    requestJson: row.request_json,
    decision: row.decision as PermissionDecision | null,
    decisionMessage: row.decision_message,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resolvedAt: row.resolved_at,
  };
}

export interface PermissionRepository {
  get(id: string): PermissionRecord | null;
  listBySession(sessionId: string): PermissionRecord[];
  listUnresolved(): PermissionRecord[];
  create(record: PermissionRecord): PermissionRecord;
  decide(
    id: string,
    decision: Exclude<PermissionDecision, 'cancelled'>,
    decisionMessage: string | null,
    resolvedAt: string,
  ): PermissionDecisionResult;
  expire(id: string, decisionMessage: string, resolvedAt: string): PermissionDecisionResult;
  cancelUnresolved(resolvedAt: string, decisionMessage: string): number;
}

class SqlitePermissionRepository implements PermissionRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(id: string): PermissionRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, session_id, tool_call_id, request_json, decision, decision_message,
                created_at, expires_at, resolved_at
         FROM permission_requests
         WHERE id = $id`,
      )
      .get({ $id: id }) as PermissionRow | undefined;
    return row ? mapPermission(row) : null;
  }

  public listBySession(sessionId: string): PermissionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, session_id, tool_call_id, request_json, decision, decision_message,
                created_at, expires_at, resolved_at
         FROM permission_requests
         WHERE session_id = $sessionId
         ORDER BY created_at, id`,
      )
      .all({ $sessionId: sessionId }) as PermissionRow[];
    return rows.map(mapPermission);
  }

  public listUnresolved(): PermissionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, session_id, tool_call_id, request_json, decision, decision_message,
                created_at, expires_at, resolved_at
         FROM permission_requests
         WHERE decision IS NULL AND resolved_at IS NULL
         ORDER BY created_at, id`,
      )
      .all() as PermissionRow[];
    return rows.map(mapPermission);
  }

  public create(record: PermissionRecord): PermissionRecord {
    this.database
      .prepare(
        `INSERT INTO permission_requests(
           id, session_id, tool_call_id, request_json, decision, decision_message,
           created_at, expires_at, resolved_at
         ) VALUES (
           $id, $sessionId, $toolCallId, $requestJson, $decision, $decisionMessage,
           $createdAt, $expiresAt, $resolvedAt
         )`,
      )
      .run({
        $createdAt: record.createdAt,
        $decision: record.decision,
        $decisionMessage: record.decisionMessage,
        $expiresAt: record.expiresAt,
        $id: record.id,
        $requestJson: record.requestJson,
        $resolvedAt: record.resolvedAt,
        $sessionId: record.sessionId,
        $toolCallId: record.toolCallId,
      });
    return record;
  }

  public decide(
    id: string,
    decision: Exclude<PermissionDecision, 'cancelled'>,
    decisionMessage: string | null,
    resolvedAt: string,
  ): PermissionDecisionResult {
    const result = this.database
      .prepare(
        `UPDATE permission_requests
         SET decision = $decision,
             decision_message = $decisionMessage,
             resolved_at = $resolvedAt
         WHERE id = $id
           AND decision IS NULL
           AND resolved_at IS NULL
           AND expires_at > $resolvedAt`,
      )
      .run({
        $decision: decision,
        $decisionMessage: decisionMessage,
        $id: id,
        $resolvedAt: resolvedAt,
      });

    const permission = this.get(id);
    if (Number(result.changes) === 1 && permission) {
      return { status: 'decided', permission };
    }
    if (!permission) {
      return { status: 'not_found' };
    }
    if (permission.decision !== null || permission.resolvedAt !== null) {
      return { status: 'already_resolved', permission };
    }
    return { status: 'expired', permission };
  }

  public expire(id: string, decisionMessage: string, resolvedAt: string): PermissionDecisionResult {
    const result = this.database
      .prepare(
        `UPDATE permission_requests
         SET decision = 'deny', decision_message = $decisionMessage, resolved_at = $resolvedAt
         WHERE id = $id AND decision IS NULL AND resolved_at IS NULL`,
      )
      .run({ $decisionMessage: decisionMessage, $id: id, $resolvedAt: resolvedAt });
    const permission = this.get(id);
    if (Number(result.changes) === 1 && permission) {
      return { status: 'decided', permission };
    }
    if (!permission) {
      return { status: 'not_found' };
    }
    return { status: 'already_resolved', permission };
  }

  public cancelUnresolved(resolvedAt: string, decisionMessage: string): number {
    const result = this.database
      .prepare(
        `UPDATE permission_requests
         SET decision = 'cancelled',
             decision_message = $decisionMessage,
             resolved_at = $resolvedAt
         WHERE decision IS NULL AND resolved_at IS NULL`,
      )
      .run({ $decisionMessage: decisionMessage, $resolvedAt: resolvedAt });
    return Number(result.changes);
  }
}

export function createPermissionRepository(database: DatabaseConnection): PermissionRepository {
  return new SqlitePermissionRepository(database);
}
