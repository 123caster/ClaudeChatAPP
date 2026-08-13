import type { DatabaseConnection } from '../connection.js';

export type DeviceRecord = {
  id: string;
  name: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

type DeviceRow = {
  id: string;
  name: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

function mapDevice(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    name: row.name,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  };
}

export interface DeviceRepository {
  countActive(): number;
  create(record: Omit<DeviceRecord, 'lastSeenAt' | 'revokedAt'>): DeviceRecord;
  findActiveByTokenHash(tokenHash: string): DeviceRecord | null;
  revoke(id: string, revokedAt: string): boolean;
  touch(id: string, lastSeenAt: string): void;
}

class SqliteDeviceRepository implements DeviceRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public countActive(): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM devices WHERE revoked_at IS NULL')
      .get() as { count: number };
    return row.count;
  }

  public create(record: Omit<DeviceRecord, 'lastSeenAt' | 'revokedAt'>): DeviceRecord {
    this.database
      .prepare(
        `INSERT INTO devices(id, name, token_hash, created_at)
         VALUES ($id, $name, $tokenHash, $createdAt)`,
      )
      .run({
        $createdAt: record.createdAt,
        $id: record.id,
        $name: record.name,
        $tokenHash: record.tokenHash,
      });

    return {
      ...record,
      lastSeenAt: null,
      revokedAt: null,
    };
  }

  public findActiveByTokenHash(tokenHash: string): DeviceRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, name, token_hash, created_at, last_seen_at, revoked_at
         FROM devices
         WHERE token_hash = $tokenHash AND revoked_at IS NULL`,
      )
      .get({ $tokenHash: tokenHash }) as DeviceRow | undefined;

    return row ? mapDevice(row) : null;
  }

  public touch(id: string, lastSeenAt: string): void {
    this.database
      .prepare('UPDATE devices SET last_seen_at = $lastSeenAt WHERE id = $id')
      .run({ $id: id, $lastSeenAt: lastSeenAt });
  }

  public revoke(id: string, revokedAt: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE devices
         SET revoked_at = $revokedAt
         WHERE id = $id AND revoked_at IS NULL`,
      )
      .run({ $id: id, $revokedAt: revokedAt });
    return result.changes === 1 || result.changes === 1n;
  }
}

export function createDeviceRepository(database: DatabaseConnection): DeviceRepository {
  return new SqliteDeviceRepository(database);
}
