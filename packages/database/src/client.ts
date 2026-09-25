import { openDatabaseConnection, type DatabaseConnection } from './connection.js';
import { migrateDatabase } from './migrate.js';
import {
  createAttachmentRepository,
  type AttachmentRepository,
} from './repositories/attachment-repository.js';
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
import { createModelRepository, type ModelRepository } from './repositories/model-repository.js';
import {
  createPermissionRepository,
  type PermissionRepository,
} from './repositories/permission-repository.js';
import {
  createProjectRepository,
  type ProjectRepository,
} from './repositories/project-repository.js';
import {
  createPushDeliveryRepository,
  type PushDeliveryRepository,
} from './repositories/push-delivery-repository.js';
import {
  createPushSubscriptionRepository,
  type PushSubscriptionRepository,
} from './repositories/push-subscription-repository.js';
import {
  createScheduledRunRepository,
  type ScheduledRunRepository,
} from './repositories/scheduled-run-repository.js';
import {
  createScheduledTaskRepository,
  type ScheduledTaskRepository,
} from './repositories/scheduled-task-repository.js';
import {
  createSessionRepository,
  type SessionRepository,
} from './repositories/session-repository.js';
import {
  createToolCallRepository,
  type ToolCallRepository,
} from './repositories/tool-call-repository.js';

export interface DatabaseClient {
  readonly attachments: AttachmentRepository;
  readonly devices: DeviceRepository;
  readonly events: EventRepository;
  readonly idempotency: IdempotencyRepository;
  readonly isOpen: boolean;
  readonly messages: MessageRepository;
  readonly models: ModelRepository;
  readonly permissions: PermissionRepository;
  readonly projects: ProjectRepository;
  readonly pushDeliveries: PushDeliveryRepository;
  readonly pushSubscriptions: PushSubscriptionRepository;
  readonly scheduledRuns: ScheduledRunRepository;
  readonly scheduledTasks: ScheduledTaskRepository;
  readonly sessions: SessionRepository;
  readonly toolCalls: ToolCallRepository;
  close(): void;
}

class NodeSqliteDatabaseClient implements DatabaseClient {
  readonly #database: DatabaseConnection;

  public readonly attachments: AttachmentRepository;
  public readonly devices: DeviceRepository;
  public readonly events: EventRepository;
  public readonly idempotency: IdempotencyRepository;
  public readonly messages: MessageRepository;
  public readonly models: ModelRepository;
  public readonly permissions: PermissionRepository;
  public readonly projects: ProjectRepository;
  public readonly pushDeliveries: PushDeliveryRepository;
  public readonly pushSubscriptions: PushSubscriptionRepository;
  public readonly scheduledRuns: ScheduledRunRepository;
  public readonly scheduledTasks: ScheduledTaskRepository;
  public readonly sessions: SessionRepository;
  public readonly toolCalls: ToolCallRepository;

  public constructor(database: DatabaseConnection) {
    this.#database = database;
    this.attachments = createAttachmentRepository(database);
    this.devices = createDeviceRepository(database);
    this.events = createEventRepository(database);
    this.idempotency = createIdempotencyRepository(database);
    this.messages = createMessageRepository(database);
    this.models = createModelRepository(database);
    this.permissions = createPermissionRepository(database);
    this.projects = createProjectRepository(database);
    this.pushDeliveries = createPushDeliveryRepository(database);
    this.pushSubscriptions = createPushSubscriptionRepository(database);
    this.scheduledRuns = createScheduledRunRepository(database);
    this.scheduledTasks = createScheduledTaskRepository(database);
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
