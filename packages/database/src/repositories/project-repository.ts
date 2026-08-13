import type { DatabaseConnection } from '../connection.js';

export type ProjectRecord = {
  id: string;
  displayName: string;
  rootPath: string;
  createdAt: string;
};

type ProjectRow = {
  id: string;
  display_name: string;
  root_path: string;
  created_at: string;
};

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    rootPath: row.root_path,
    createdAt: row.created_at,
  };
}

export interface ProjectRepository {
  list(): ProjectRecord[];
  synchronize(records: readonly ProjectRecord[]): void;
  upsert(record: ProjectRecord): void;
}

class SqliteProjectRepository implements ProjectRepository {
  public constructor(private readonly database: DatabaseConnection) {}

  public upsert(record: ProjectRecord): void {
    this.upsertStatement(record);
  }

  public synchronize(records: readonly ProjectRecord[]): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.exec('UPDATE projects SET enabled = 0');
      for (const record of records) {
        this.upsertStatement(record);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    }
  }

  private upsertStatement(record: ProjectRecord): void {
    this.database
      .prepare(
        `INSERT INTO projects(id, display_name, root_path, created_at, enabled)
         VALUES ($id, $displayName, $rootPath, $createdAt, 1)
         ON CONFLICT(root_path) DO UPDATE SET
           display_name = excluded.display_name,
           enabled = 1`,
      )
      .run({
        $createdAt: record.createdAt,
        $displayName: record.displayName,
        $id: record.id,
        $rootPath: record.rootPath,
      });
  }

  public list(): ProjectRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, display_name, root_path, created_at
         FROM projects
         WHERE enabled = 1
         ORDER BY display_name COLLATE NOCASE, id`,
      )
      .all() as ProjectRow[];
    return rows.map(mapProject);
  }
}

export function createProjectRepository(database: DatabaseConnection): ProjectRepository {
  return new SqliteProjectRepository(database);
}
