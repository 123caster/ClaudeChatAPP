import type { DatabaseConnection } from '../connection.js';

export type IdempotencyRecord = {
  requestId: string;
  operation: string;
  fingerprint: string;
  resultJson: string;
  createdAt: string;
  completedAt: string;
};

export type IdempotencyRequest = Omit<IdempotencyRecord, 'resultJson'>;

export type IdempotencyResult<T> = {
  replayed: boolean;
  value: T;
};

type IdempotencyRow = {
  request_id: string;
  operation: string;
  fingerprint: string;
  result_json: string;
  created_at: string;
  completed_at: string;
};

function mapIdempotency(row: IdempotencyRow): IdempotencyRecord {
  return {
    requestId: row.request_id,
    operation: row.operation,
    fingerprint: row.fingerprint,
    resultJson: row.result_json,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export class IdempotencyConflictError extends Error {
  public constructor(requestId: string) {
    super(`Request ID ${requestId} was already used with different input.`);
    this.name = 'IdempotencyConflictError';
  }
}

export interface IdempotencyRepository {
  get(requestId: string): IdempotencyRecord | null;
  execute<T>(request: IdempotencyRequest, operation: () => T): IdempotencyResult<T>;
}

class SqliteIdempotencyRepository implements IdempotencyRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public get(requestId: string): IdempotencyRecord | null {
    const row = this.database
      .prepare(
        `SELECT request_id, operation, fingerprint, result_json, created_at, completed_at
         FROM write_requests
         WHERE request_id = $requestId`,
      )
      .get({ $requestId: requestId }) as IdempotencyRow | undefined;
    return row ? mapIdempotency(row) : null;
  }

  public execute<T>(request: IdempotencyRequest, operation: () => T): IdempotencyResult<T> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.get(request.requestId);
      if (existing) {
        if (
          existing.operation !== request.operation ||
          existing.fingerprint !== request.fingerprint
        ) {
          throw new IdempotencyConflictError(request.requestId);
        }

        const value = JSON.parse(existing.resultJson) as T;
        this.database.exec('COMMIT');
        return { replayed: true, value };
      }

      const value = operation();
      const resultJson = JSON.stringify(value);
      if (resultJson === undefined) {
        throw new TypeError('Idempotent operation result must be JSON serializable.');
      }

      this.database
        .prepare(
          `INSERT INTO write_requests(
             request_id, operation, fingerprint, result_json, created_at, completed_at
           ) VALUES (
             $requestId, $operation, $fingerprint, $resultJson, $createdAt, $completedAt
           )`,
        )
        .run({
          $completedAt: request.completedAt,
          $createdAt: request.createdAt,
          $fingerprint: request.fingerprint,
          $operation: request.operation,
          $requestId: request.requestId,
          $resultJson: resultJson,
        });
      this.database.exec('COMMIT');
      return { replayed: false, value };
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    }
  }
}

export function createIdempotencyRepository(database: DatabaseConnection): IdempotencyRepository {
  return new SqliteIdempotencyRepository(database);
}
