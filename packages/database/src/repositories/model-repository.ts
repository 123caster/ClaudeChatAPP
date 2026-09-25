import type { DatabaseConnection } from '../connection.js';

export type ModelRecord = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  isActive: boolean;
  supportsImages: boolean;
  supportsDocuments: boolean;
  isMultimodalDefault: boolean;
  createdAt: string;
};

export type CreateModelRecord = Omit<
  ModelRecord,
  'supportsImages' | 'supportsDocuments' | 'isMultimodalDefault'
> &
  Partial<Pick<ModelRecord, 'supportsImages' | 'supportsDocuments' | 'isMultimodalDefault'>>;

export type UpdateModelRecord = Partial<
  Pick<
    ModelRecord,
    'name' | 'baseUrl' | 'apiKey' | 'model' | 'supportsImages' | 'supportsDocuments'
  >
>;

type ModelRow = {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_key: string;
  is_active: number;
  supports_images: number;
  supports_documents: number;
  is_multimodal_default: number;
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
    supportsImages: row.supports_images === 1,
    supportsDocuments: row.supports_documents === 1,
    isMultimodalDefault: row.is_multimodal_default === 1,
    createdAt: row.created_at,
  };
}

export interface ModelRepository {
  list(): ModelRecord[];
  get(id: string): ModelRecord | null;
  create(record: CreateModelRecord): ModelRecord;
  update(id: string, changes: UpdateModelRecord): ModelRecord | null;
  setActive(id: string): boolean;
  setMultimodalDefault(id: string): boolean;
  clearMultimodalDefault(id: string): boolean;
  delete(id: string): boolean;
  getActive(): ModelRecord | null;
  getMultimodalDefault(): ModelRecord | null;
}

class SqliteModelRepository implements ModelRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public list(): ModelRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, base_url, model, api_key, is_active, supports_images,
                supports_documents, is_multimodal_default, created_at
         FROM models
         ORDER BY created_at ASC, id`,
      )
      .all() as ModelRow[];
    return rows.map(mapModel);
  }

  public get(id: string): ModelRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, name, base_url, model, api_key, is_active, supports_images,
                supports_documents, is_multimodal_default, created_at
         FROM models WHERE id = $id`,
      )
      .get({ $id: id }) as ModelRow | undefined;
    return row ? mapModel(row) : null;
  }

  public create(record: CreateModelRecord): ModelRecord {
    const next: ModelRecord = {
      ...record,
      supportsImages: record.supportsImages ?? false,
      supportsDocuments: record.supportsDocuments ?? false,
      isMultimodalDefault: record.isMultimodalDefault ?? false,
    };
    this.database
      .prepare(
        `INSERT INTO models(
           id, name, base_url, model, api_key, is_active, supports_images,
           supports_documents, is_multimodal_default, created_at
         ) VALUES (
           $id, $name, $baseUrl, $model, $apiKey, $isActive, $supportsImages,
           $supportsDocuments, $isMultimodalDefault, $createdAt
         )`,
      )
      .run({
        $id: next.id,
        $name: next.name,
        $baseUrl: next.baseUrl,
        $model: next.model,
        $apiKey: next.apiKey,
        $isActive: next.isActive ? 1 : 0,
        $supportsImages: next.supportsImages ? 1 : 0,
        $supportsDocuments: next.supportsDocuments ? 1 : 0,
        $isMultimodalDefault: next.isMultimodalDefault ? 1 : 0,
        $createdAt: next.createdAt,
      });

    return next;
  }

  public update(id: string, changes: UpdateModelRecord): ModelRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    const next = {
      ...existing,
      ...changes,
      isMultimodalDefault:
        (changes.supportsImages ?? existing.supportsImages) && existing.isMultimodalDefault,
    };
    this.database
      .prepare(
        `UPDATE models
         SET name = $name,
             base_url = $baseUrl,
             model = $model,
             api_key = $apiKey,
             supports_images = $supportsImages,
             supports_documents = $supportsDocuments,
             is_multimodal_default = $isMultimodalDefault
         WHERE id = $id`,
      )
      .run({
        $apiKey: next.apiKey,
        $baseUrl: next.baseUrl,
        $id: id,
        $model: next.model,
        $name: next.name,
        $supportsImages: next.supportsImages ? 1 : 0,
        $supportsDocuments: next.supportsDocuments ? 1 : 0,
        $isMultimodalDefault: next.isMultimodalDefault ? 1 : 0,
      });
    return this.get(id);
  }

  public setActive(id: string): boolean {
    const exists = this.database
      .prepare('SELECT 1 AS present FROM models WHERE id = $id')
      .get({ $id: id });
    if (!exists) return false;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('UPDATE models SET is_active = 0');
      this.database.prepare('UPDATE models SET is_active = 1 WHERE id = $id').run({ $id: id });
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    }
    return true;
  }

  public setMultimodalDefault(id: string): boolean {
    const model = this.get(id);
    if (!model?.supportsImages) return false;

    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('UPDATE models SET is_multimodal_default = 0');
      this.database
        .prepare('UPDATE models SET is_multimodal_default = 1 WHERE id = $id')
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

  public clearMultimodalDefault(id: string): boolean {
    const exists = this.database
      .prepare('SELECT 1 AS present FROM models WHERE id = $id')
      .get({ $id: id });
    if (!exists) return false;
    this.database
      .prepare('UPDATE models SET is_multimodal_default = 0 WHERE id = $id')
      .run({ $id: id });
    return true;
  }

  public delete(id: string): boolean {
    const result = this.database.prepare('DELETE FROM models WHERE id = $id').run({ $id: id });
    return result.changes === 1 || result.changes === 1n;
  }

  public getActive(): ModelRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, name, base_url, model, api_key, is_active, supports_images,
                supports_documents, is_multimodal_default, created_at
         FROM models
         WHERE is_active = 1
         LIMIT 1`,
      )
      .get() as ModelRow | undefined;
    return row ? mapModel(row) : null;
  }

  public getMultimodalDefault(): ModelRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, name, base_url, model, api_key, is_active, supports_images,
                supports_documents, is_multimodal_default, created_at
         FROM models
         WHERE is_multimodal_default = 1
         LIMIT 1`,
      )
      .get() as ModelRow | undefined;
    return row ? mapModel(row) : null;
  }
}

export function createModelRepository(database: DatabaseConnection): ModelRepository {
  return new SqliteModelRepository(database);
}
