import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

export interface DatabaseConnection {
  readonly isOpen: boolean;
  readonly isTransaction: boolean;
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
}

export function openDatabaseConnection(filename: string): DatabaseConnection {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const database = new DatabaseSync(filename, {
    allowBareNamedParameters: false,
    allowExtension: false,
    allowUnknownNamedParameters: false,
    defensive: true,
    enableForeignKeyConstraints: true,
    timeout: 3_000,
  });

  if (filename !== ':memory:') {
    database.exec('PRAGMA journal_mode = WAL');
  }

  return database;
}
