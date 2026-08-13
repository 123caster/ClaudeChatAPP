export { closeDatabase, createDatabase } from './client.js';
export type { DatabaseClient } from './client.js';
export type { DeviceRecord, DeviceRepository } from './repositories/device-repository.js';
export type { AppendEvent, EventRecord, EventRepository } from './repositories/event-repository.js';
export {
  IdempotencyConflictError,
  type IdempotencyRecord,
  type IdempotencyRepository,
  type IdempotencyRequest,
  type IdempotencyResult,
} from './repositories/idempotency-repository.js';
export type { MessageRecord, MessageRepository } from './repositories/message-repository.js';
export {
  permissionDecisions,
  type PermissionDecision,
  type PermissionDecisionResult,
  type PermissionRecord,
  type PermissionRepository,
} from './repositories/permission-repository.js';
export type { ProjectRecord, ProjectRepository } from './repositories/project-repository.js';
export {
  sessionStatuses,
  type SessionListOptions,
  type SessionRecord,
  type SessionRepository,
  type SessionStatus,
} from './repositories/session-repository.js';
export type { ToolCallRecord, ToolCallRepository } from './repositories/tool-call-repository.js';
