export { closeDatabase, createDatabase } from './client.js';
export type { DatabaseClient } from './client.js';
export type {
  AttachmentKind,
  AttachmentRecord,
  AttachmentRepository,
  AttachmentStatus,
} from './repositories/attachment-repository.js';
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
export type {
  CreateModelRecord,
  ModelRecord,
  ModelRepository,
  UpdateModelRecord,
} from './repositories/model-repository.js';
export {
  permissionDecisions,
  type PermissionDecision,
  type PermissionDecisionResult,
  type PermissionRecord,
  type PermissionRepository,
} from './repositories/permission-repository.js';
export type {
  ProjectOrigin,
  ProjectRecord,
  ProjectRepository,
} from './repositories/project-repository.js';
export type {
  PushDeliveryRecord,
  PushDeliveryRepository,
  PushDeliveryStatus,
} from './repositories/push-delivery-repository.js';
export type {
  PushSubscriptionRecord,
  PushSubscriptionRepository,
} from './repositories/push-subscription-repository.js';
export {
  scheduledRunStatuses,
  type CreateScheduledRunRecord,
  type ScheduledNotificationStatus,
  type ScheduledRunRecord,
  type ScheduledRunRepository,
  type ScheduledRunStatus,
  type ScheduledRunTrigger,
  type UpdateScheduledRunRecord,
} from './repositories/scheduled-run-repository.js';
export {
  scheduledTaskStatuses,
  type CreateScheduledTaskRecord,
  type ScheduledTaskRecord,
  type ScheduledTaskRepository,
  type ScheduledTaskStatus,
  type UpdateScheduledTaskRecord,
} from './repositories/scheduled-task-repository.js';
export {
  sessionStatuses,
  type SessionListOptions,
  type SessionRecord,
  type SessionRepository,
  type SessionStatus,
} from './repositories/session-repository.js';
export type { ToolCallRecord, ToolCallRepository } from './repositories/tool-call-repository.js';
