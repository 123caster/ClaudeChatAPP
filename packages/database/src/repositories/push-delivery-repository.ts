import type { DatabaseConnection } from '../connection.js';

export type PushDeliveryStatus = 'pending' | 'delivered' | 'failed';

export type PushDeliveryRecord = {
  id: string;
  runId: string;
  deviceId: string;
  ticketId: string;
  status: PushDeliveryStatus;
  errorCode: string | null;
  attemptCount: number;
  nextCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type PushDeliveryRow = {
  id: string;
  run_id: string;
  device_id: string;
  ticket_id: string;
  status: string;
  error_code: string | null;
  attempt_count: number;
  next_check_at: string | null;
  created_at: string;
  updated_at: string;
};

const columns =
  'id, run_id, device_id, ticket_id, status, error_code, attempt_count, next_check_at, created_at, updated_at';

function mapDelivery(row: PushDeliveryRow): PushDeliveryRecord {
  if (!['pending', 'delivered', 'failed'].includes(row.status)) {
    throw new Error(`Unknown push delivery status: ${row.status}`);
  }
  return {
    id: row.id,
    runId: row.run_id,
    deviceId: row.device_id,
    ticketId: row.ticket_id,
    status: row.status as PushDeliveryStatus,
    errorCode: row.error_code,
    attemptCount: row.attempt_count,
    nextCheckAt: row.next_check_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PushDeliveryRepository {
  get(id: string): PushDeliveryRecord | null;
  create(record: PushDeliveryRecord): PushDeliveryRecord;
  listDue(now: string, limit?: number): PushDeliveryRecord[];
  listByRun(runId: string): PushDeliveryRecord[];
  update(
    id: string,
    changes: Partial<
      Pick<PushDeliveryRecord, 'status' | 'errorCode' | 'attemptCount' | 'nextCheckAt'>
    >,
    updatedAt: string,
  ): PushDeliveryRecord | null;
}

class SqlitePushDeliveryRepository implements PushDeliveryRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(id: string): PushDeliveryRecord | null {
    const row = this.database
      .prepare(`SELECT ${columns} FROM push_deliveries WHERE id = $id`)
      .get({ $id: id }) as PushDeliveryRow | undefined;
    return row ? mapDelivery(row) : null;
  }

  public create(record: PushDeliveryRecord): PushDeliveryRecord {
    this.database
      .prepare(
        `INSERT INTO push_deliveries(
           id, run_id, device_id, ticket_id, status, error_code, attempt_count,
           next_check_at, created_at, updated_at
         ) VALUES (
           $id, $runId, $deviceId, $ticketId, $status, $errorCode, $attemptCount,
           $nextCheckAt, $createdAt, $updatedAt
         )`,
      )
      .run({
        $attemptCount: record.attemptCount,
        $createdAt: record.createdAt,
        $deviceId: record.deviceId,
        $errorCode: record.errorCode,
        $id: record.id,
        $nextCheckAt: record.nextCheckAt,
        $runId: record.runId,
        $status: record.status,
        $ticketId: record.ticketId,
        $updatedAt: record.updatedAt,
      });
    return this.get(record.id)!;
  }

  public listDue(now: string, limit = 100): PushDeliveryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${columns}
         FROM push_deliveries
         WHERE status = 'pending' AND next_check_at <= $now
         ORDER BY next_check_at, id
         LIMIT $limit`,
      )
      .all({ $limit: limit, $now: now }) as PushDeliveryRow[];
    return rows.map(mapDelivery);
  }

  public listByRun(runId: string): PushDeliveryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${columns}
         FROM push_deliveries
         WHERE run_id = $runId
         ORDER BY created_at DESC, id`,
      )
      .all({ $runId: runId }) as PushDeliveryRow[];
    return rows.map(mapDelivery);
  }

  public update(
    id: string,
    changes: Partial<
      Pick<PushDeliveryRecord, 'status' | 'errorCode' | 'attemptCount' | 'nextCheckAt'>
    >,
    updatedAt: string,
  ): PushDeliveryRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    const next = { ...existing, ...changes, updatedAt };
    this.database
      .prepare(
        `UPDATE push_deliveries
         SET status = $status,
             error_code = $errorCode,
             attempt_count = $attemptCount,
             next_check_at = $nextCheckAt,
             updated_at = $updatedAt
         WHERE id = $id`,
      )
      .run({
        $attemptCount: next.attemptCount,
        $errorCode: next.errorCode,
        $id: id,
        $nextCheckAt: next.nextCheckAt,
        $status: next.status,
        $updatedAt: updatedAt,
      });
    return this.get(id);
  }
}

export function createPushDeliveryRepository(database: DatabaseConnection): PushDeliveryRepository {
  return new SqlitePushDeliveryRepository(database);
}
