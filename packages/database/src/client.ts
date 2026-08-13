import { openDatabaseConnection, type DatabaseConnection } from './connection.js';
import { migrateDatabase } from './migrate.js';
import { createDeviceRepository, type DeviceRepository } from './repositories/device-repository.js';
import {
  createProjectRepository,
  type ProjectRepository,
} from './repositories/project-repository.js';

export interface DatabaseClient {
  readonly devices: DeviceRepository;
  readonly isOpen: boolean;
  readonly projects: ProjectRepository;
  close(): void;
}

class NodeSqliteDatabaseClient implements DatabaseClient {
  readonly #database: DatabaseConnection;

  public readonly devices: DeviceRepository;
  public readonly projects: ProjectRepository;

  public constructor(database: DatabaseConnection) {
    this.#database = database;
    this.devices = createDeviceRepository(database);
    this.projects = createProjectRepository(database);
  }

  public get isOpen(): boolean {
    return this.#database.isOpen;
  }

  public close(): void {
    if (this.#database.isOpen) {
      this.#database.close();
    }
  }
}

export function createDatabase(
  filename: string,
  now: () => Date = () => new Date(),
): DatabaseClient {
  const database = openDatabaseConnection(filename);

  try {
    migrateDatabase(database, now);
    return new NodeSqliteDatabaseClient(database);
  } catch (error) {
    if (database.isOpen) {
      database.close();
    }
    throw error;
  }
}

export function closeDatabase(database: DatabaseClient): void {
  if (database.isOpen) {
    database.close();
  }
}
