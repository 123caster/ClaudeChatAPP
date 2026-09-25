import type { DatabaseConnection } from './connection.js';
import { initialMigration } from './migrations/001-initial.js';
import { projectEnabledMigration } from './migrations/002-project-enabled.js';
import { singleActiveDeviceMigration } from './migrations/003-single-active-device.js';
import { sessionEventRepositoriesMigration } from './migrations/004-session-event-repositories.js';
import { sessionInterruptionReasonMigration } from './migrations/005-session-interruption-reason.js';
import { projectOriginMigration } from './migrations/006-project-origin.js';
import { modelsMigration } from './migrations/007-models.js';
import { sessionModelMigration } from './migrations/008-session-model.js';
import { sessionWorkingDirectoryMigration } from './migrations/009-session-working-directory.js';
import { attachmentsAndModelCapabilitiesMigration } from './migrations/010-attachments-and-model-capabilities.js';
import { scheduledAutomationsMigration } from './migrations/011-scheduled-automations.js';
import { pushDeliveriesMigration } from './migrations/012-push-deliveries.js';

export type Migration = {
  version: number;
  sql: string;
};

const migrations: Migration[] = [
  { version: 1, sql: initialMigration },
  { version: 2, sql: projectEnabledMigration },
  { version: 3, sql: singleActiveDeviceMigration },
  { version: 4, sql: sessionEventRepositoriesMigration },
  { version: 5, sql: sessionInterruptionReasonMigration },
  { version: 6, sql: projectOriginMigration },
  { version: 7, sql: modelsMigration },
  { version: 8, sql: sessionModelMigration },
  { version: 9, sql: sessionWorkingDirectoryMigration },
  { version: 10, sql: attachmentsAndModelCapabilitiesMigration },
  { version: 11, sql: scheduledAutomationsMigration },
  { version: 12, sql: pushDeliveriesMigration },
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
