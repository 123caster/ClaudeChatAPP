import {
  createScheduledTaskRequestSchema,
  deleteScheduledTaskRequestSchema,
  markScheduledTaskReadRequestSchema,
  runScheduledTaskRequestSchema,
  scheduledTaskDraftRequestSchema,
  scheduledTaskParamsSchema,
  updateScheduledTaskRequestSchema,
} from '@claude-chat/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { sendError } from '../http-error.js';
import { ProjectPathError } from '../projects/path-policy.js';
import { InvalidScheduleError } from '../scheduled/schedule-calculator.js';
import {
  ScheduledTaskAlreadyRunningError,
  type ScheduledRunService,
} from '../scheduled/scheduled-run-service.js';
import {
  IdempotencyConflictError,
  ScheduledTaskConfigError,
  ScheduledTaskNotFoundError,
  type ScheduledTaskService,
} from '../scheduled/scheduled-task-service.js';

type ScheduledTaskRouteOptions = {
  tasks: ScheduledTaskService;
  runs: ScheduledRunService;
};

function handleDomainError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof ScheduledTaskNotFoundError) {
    return sendError(request, reply, 404, 'NOT_FOUND', error.message);
  }
  if (error instanceof ScheduledTaskAlreadyRunningError) {
    return sendError(request, reply, 409, 'TASK_ALREADY_RUNNING', error.message);
  }
  if (error instanceof IdempotencyConflictError) {
    return sendError(request, reply, 409, 'CONFLICT', error.message);
  }
  if (error instanceof ScheduledTaskConfigError || error instanceof InvalidScheduleError) {
    return sendError(request, reply, 400, 'TASK_CONFIG_INVALID', error.message);
  }
  if (error instanceof ProjectPathError) {
    return sendError(request, reply, 400, 'PROJECT_PATH_INVALID', error.message);
  }
  throw error;
}

export function registerScheduledTaskRoutes(
  app: FastifyInstance,
  { tasks, runs }: ScheduledTaskRouteOptions,
): void {
  app.get('/v1/scheduled-tasks', async () => tasks.list());

  app.get('/v1/scheduled-tasks/:taskId', async (request, reply) => {
    const params = scheduledTaskParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid scheduled task ID.');
    }
    try {
      return tasks.detail(params.data.taskId);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.get('/v1/scheduled-tasks/:taskId/runs', async (request, reply) => {
    const params = scheduledTaskParamsSchema.safeParse(request.params);
    if (!params.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid scheduled task ID.');
    }
    try {
      return { runs: tasks.detail(params.data.taskId).runs };
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/scheduled-tasks', async (request, reply) => {
    const body = createScheduledTaskRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid scheduled task request.');
    }
    try {
      return reply.status(201).send(tasks.create(body.data));
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/scheduled-tasks/draft', async (request, reply) => {
    const body = scheduledTaskDraftRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid schedule draft request.');
    }
    return tasks.draft(body.data);
  });

  app.post('/v1/scheduled-tasks/:taskId/update', async (request, reply) => {
    const params = scheduledTaskParamsSchema.safeParse(request.params);
    const body = updateScheduledTaskRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid scheduled task update.');
    }
    try {
      return tasks.update(params.data.taskId, body.data);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/scheduled-tasks/:taskId/run', async (request, reply) => {
    const params = scheduledTaskParamsSchema.safeParse(request.params);
    const body = runScheduledTaskRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid scheduled run request.');
    }
    try {
      const task = tasks.getRecord(params.data.taskId);
      return reply.status(202).send(runs.queueManual(task, body.data.requestId));
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/scheduled-tasks/:taskId/read', async (request, reply) => {
    const params = scheduledTaskParamsSchema.safeParse(request.params);
    const body = markScheduledTaskReadRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid scheduled task request.');
    }
    try {
      return tasks.markRead(params.data.taskId, body.data.requestId);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });

  app.post('/v1/scheduled-tasks/:taskId/delete', async (request, reply) => {
    const params = scheduledTaskParamsSchema.safeParse(request.params);
    const body = deleteScheduledTaskRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid scheduled task request.');
    }
    try {
      return tasks.delete(params.data.taskId, body.data.requestId);
    } catch (error) {
      return handleDomainError(request, reply, error);
    }
  });
}
