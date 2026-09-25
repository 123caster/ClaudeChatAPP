import type { ScheduledRunRecord, ScheduledTaskRecord } from '@claude-chat/database';
import { scheduleSchema, type ScheduledRun, type ScheduledTask } from '@claude-chat/protocol';

export function serializeScheduledTask(record: ScheduledTaskRecord): ScheduledTask {
  return {
    id: record.id,
    name: record.name,
    prompt: record.prompt,
    status: record.status,
    triggerType: record.triggerType,
    schedule: scheduleSchema.parse(JSON.parse(record.scheduleJson) as unknown),
    timeZone: record.timeZone,
    nextRunAt: record.nextRunAt,
    lastRunAt: record.lastRunAt,
    sessionId: record.sessionId,
    projectId: record.projectId,
    workingDirectory: record.workingDirectory,
    modelId: record.modelId,
    allowAutoWrite: record.allowAutoWrite,
    notificationPolicy: record.notificationPolicy,
    unreadCount: record.unreadCount,
    needsAttention: record.needsAttention,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
  };
}

export function serializeScheduledRun(record: ScheduledRunRecord): ScheduledRun {
  return {
    id: record.id,
    taskId: record.taskId,
    scheduledFor: record.scheduledFor,
    triggerSource: record.triggerSource,
    status: record.status,
    requestId: record.requestId,
    userMessageId: record.userMessageId,
    assistantMessageId: record.assistantMessageId,
    attemptCount: record.attemptCount,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    notificationStatus: record.notificationStatus,
    isRead: record.readAt !== null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
