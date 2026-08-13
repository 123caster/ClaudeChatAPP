import type { DatabaseConnection } from './connection.js';
import { initialMigration } from './migrations/001-initial.js';
import { projectEnabledMigration } from './migrations/002-project-enabled.js';
import { singleActiveDeviceMigration } from './migrations/003-single-active-device.js';

export type Migration = {
  version: number;
  sql: string;
};

const migrations: Migration[] = [
  { version: 1, sql: initialMigration },
  { version: 2, sql: projectEnabledMigration },
  { version: 3, sql: singleActiveDeviceMigration },
];

export function runMigrations(
  database: DatabaseConnection,
  migrationPlan: readonly Migration[],
  now: () => Date = () => new Date(),
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const hasMigration = database.prepare(
    'SELECT 1 AS present FROM schema_migrations WHERE version = $version',
  );
  const insertMigration = database.prepare(
    `INSERT INTO schema_migrations(version, applied_at)
     VALUES ($version, $appliedAt)`,
  );

  for (const migration of migrationPlan) {
    database.exec('BEGIN IMMEDIATE');
    try {
      if (hasMigration.get({ $version: migration.version })) {
        database.exec('COMMIT');
        continue;
      }

      database.exec(migration.sql);
      insertMigration.run({
        $appliedAt: now().toISOString(),
        $version: migration.version,
      });
      database.exec('COMMIT');
    } catch (error) {
      if (database.isTransaction) {
        database.exec('ROLLBACK');
      }
      throw error;
    }
  }
}

export function migrateDatabase(
  database: DatabaseConnection,
  now: () => Date = () => new Date(),
): void {
  runMigrations(database, migrations, now);
}
