import type { DatabaseConnection } from '../connection.js';

export type ModelRecord = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  isActive: boolean;
  createdAt: string;
};

type ModelRow = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  is_active: number;
  created_at: string;
};

function mapModel(row: ModelRow): ModelRecord {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    apiKey: row.api_key,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

export interface ModelRepository {
  list(): ModelRecord[];
  create(record: ModelRecord): ModelRecord;
  setActive(id: string): boolean;
  delete(id: string): boolean;
  getActive(): ModelRecord | null;
}

class SqliteModelRepository implements ModelRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public list(): ModelRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, base_url, model, api_key, is_active, created_at
         FROM models
         ORDER BY created_at ASC, id`,
      )
      .all() as ModelRow[];
    return rows.map(mapModel);
  }

  public create(record: ModelRecord): ModelRecord {
    this.database
      .prepare(
        `INSERT INTO models(id, name, base_url, model, api_key, is_active, created_at)
         VALUES ($id, $name, $baseUrl, $model, $apiKey, $isActive, $createdAt)`,
      )
      .run({
        $id: record.id,
        $name: record.name,
        $baseUrl: record.baseUrl,
        $model: record.model,
        $apiKey: record.apiKey,
        $isActive: record.isActive ? 1 : 0,
        $createdAt: record.createdAt,
      });

    return record;
  }

  public setActive(id: string): boolean {
    const exists = this.database
      .prepare('SELECT 1 AS present FROM models WHERE id = $id')
      .get({ $id: id });
    if (!exists) return false;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('UPDATE models SET is_active = 0');
      this.database
        .prepare('UPDATE models SET is_active = 1 WHERE id = $id')
        .run({ $id: id });
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    }
    return true;
  }

  public delete(id: string): boolean {
    const result = this.database.prepare('DELETE FROM models WHERE id = $id').run({ $id: id });
    return result.changes === 1 || result.changes === 1n;
  }

  public getActive(): ModelRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, name, base_url, model, api_key, is_active, created_at
         FROM models
         WHERE is_active = 1
         LIMIT 1`,
      )
      .get() as ModelRow | undefined;
    return row ? mapModel(row) : null;
  }
}

export function createModelRepository(database: DatabaseConnection): ModelRepository {
  return new SqliteModelRepository(database);
}
