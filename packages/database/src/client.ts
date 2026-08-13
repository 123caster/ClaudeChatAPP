import { openDatabaseConnection, type DatabaseConnection } from './connection.js';
import { migrateDatabase } from './migrate.js';
import { createDeviceRepository, type DeviceRepository } from './repositories/device-repository.js';
import { createEventRepository, type EventRepository } from './repositories/event-repository.js';
import {
  createIdempotencyRepository,
  type IdempotencyRepository,
} from './repositories/idempotency-repository.js';
import {
  createMessageRepository,
  type MessageRepository,
} from './repositories/message-repository.js';
import {
  createPermissionRepository,
  type PermissionRepository,
} from './repositories/permission-repository.js';
import {
  createProjectRepository,
  type ProjectRepository,
} from './repositories/project-repository.js';
import {
  createSessionRepository,
  type SessionRepository,
} from './repositories/session-repository.js';
import {
  createToolCallRepository,
  type ToolCallRepository,
} from './repositories/tool-call-repository.js';

export interface DatabaseClient {
  readonly devices: DeviceRepository;
  readonly events: EventRepository;
  readonly idempotency: IdempotencyRepository;
  readonly isOpen: boolean;
  readonly messages: MessageRepository;
  readonly permissions: PermissionRepository;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly toolCalls: ToolCallRepository;
  close(): void;
}

class NodeSqliteDatabaseClient implements DatabaseClient {
  readonly #database: DatabaseConnection;

  public readonly devices: DeviceRepository;
  public readonly events: EventRepository;
  public readonly idempotency: IdempotencyRepository;
  public readonly messages: MessageRepository;
  public readonly permissions: PermissionRepository;
  public readonly projects: ProjectRepository;
  public readonly sessions: SessionRepository;
  public readonly toolCalls: ToolCallRepository;

  public constructor(database: DatabaseConnection) {
    this.#database = database;
    this.devices = createDeviceRepository(database);
    this.events = createEventRepository(database);
    this.idempotency = createIdempotencyRepository(database);
    this.messages = createMessageRepository(database);
    this.permissions = createPermissionRepository(database);
    this.projects = createProjectRepository(database);
    this.sessions = createSessionRepository(database);
    this.toolCalls = createToolCallRepository(database);
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
