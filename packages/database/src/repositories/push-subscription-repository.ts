import type { DatabaseConnection } from '../connection.js';

export type PushSubscriptionRecord = {
  deviceId: string;
  provider: 'expo';
  platform: 'android';
  token: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

type PushSubscriptionRow = {
  device_id: string;
  provider: string;
  platform: string;
  token: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
};

function mapSubscription(row: PushSubscriptionRow): PushSubscriptionRecord {
  if (row.provider !== 'expo' || row.platform !== 'android') {
    throw new Error(`Unknown push provider or platform: ${row.provider}/${row.platform}`);
  }
  return {
    deviceId: row.device_id,
    provider: 'expo',
    platform: 'android',
    token: row.token,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disabledAt: row.disabled_at,
  };
}

const subscriptionColumns =
  'device_id, provider, platform, token, enabled, created_at, updated_at, disabled_at';

export interface PushSubscriptionRepository {
  getByDevice(deviceId: string): PushSubscriptionRecord | null;
  listEnabled(): PushSubscriptionRecord[];
  upsert(record: Omit<PushSubscriptionRecord, 'enabled' | 'disabledAt'>): PushSubscriptionRecord;
  disable(deviceId: string, disabledAt: string): PushSubscriptionRecord | null;
  delete(deviceId: string): boolean;
}

class SqlitePushSubscriptionRepository implements PushSubscriptionRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public getByDevice(deviceId: string): PushSubscriptionRecord | null {
    const row = this.database
      .prepare(`SELECT ${subscriptionColumns} FROM push_subscriptions WHERE device_id = $deviceId`)
      .get({ $deviceId: deviceId }) as PushSubscriptionRow | undefined;
    return row ? mapSubscription(row) : null;
  }

  public listEnabled(): PushSubscriptionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT ${subscriptionColumns}
         FROM push_subscriptions
         WHERE enabled = 1
         ORDER BY updated_at DESC, device_id`,
      )
      .all() as PushSubscriptionRow[];
    return rows.map(mapSubscription);
  }

  public upsert(
    record: Omit<PushSubscriptionRecord, 'enabled' | 'disabledAt'>,
  ): PushSubscriptionRecord {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database
        .prepare('DELETE FROM push_subscriptions WHERE token = $token AND device_id <> $deviceId')
        .run({ $deviceId: record.deviceId, $token: record.token });
      this.database
        .prepare(
          `INSERT INTO push_subscriptions(
             device_id, provider, platform, token, enabled, created_at, updated_at, disabled_at
           ) VALUES ($deviceId, $provider, $platform, $token, 1, $createdAt, $updatedAt, NULL)
           ON CONFLICT(device_id) DO UPDATE SET
             provider = excluded.provider,
             platform = excluded.platform,
             token = excluded.token,
             enabled = 1,
             updated_at = excluded.updated_at,
             disabled_at = NULL`,
        )
        .run({
          $createdAt: record.createdAt,
          $deviceId: record.deviceId,
          $platform: record.platform,
          $provider: record.provider,
          $token: record.token,
          $updatedAt: record.updatedAt,
        });
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
    return this.getByDevice(record.deviceId)!;
  }

  public disable(deviceId: string, disabledAt: string): PushSubscriptionRecord | null {
    this.database
      .prepare(
        `UPDATE push_subscriptions
         SET enabled = 0, disabled_at = $disabledAt, updated_at = $disabledAt
         WHERE device_id = $deviceId`,
      )
      .run({ $deviceId: deviceId, $disabledAt: disabledAt });
    return this.getByDevice(deviceId);
  }

  public delete(deviceId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM push_subscriptions WHERE device_id = $deviceId')
      .run({ $deviceId: deviceId });
    return Number(result.changes) === 1;
  }
}

export function createPushSubscriptionRepository(
  database: DatabaseConnection,
): PushSubscriptionRepository {
  return new SqlitePushSubscriptionRepository(database);
}
