import {
  createProjectRequestSchema,
  createProjectFileRequestSchema,
  createProjectFileResponseSchema,
  deleteProjectRequestSchema,
  deleteProjectResponseSchema,
  deleteProjectFileRequestSchema,
  deleteProjectFileResponseSchema,
  listDirectoryResponseSchema,
  projectParamsSchema,
  type CreateProjectResponse,
  type CreateProjectFileResponse,
  type DeleteProjectResponse,
  type DeleteProjectFileResponse,
  type ListDirectoryResponse,
  type ProjectsResponse,
} from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sendError } from '../http-error.js';
import { ProjectPathError } from '../projects/path-policy.js';
import type { ProjectRegistry } from '../projects/project-registry.js';

type ProjectRouteOptions = {
  projects: ProjectRegistry;
};

const directoryQuerySchema = z.object({ path: z.string().max(4_000).optional() }).strict();

function toSummary(project: {
  id: string;
  displayName: string;
  rootPath: string;
  origin?: 'config' | 'user';
}) {
  return {
    id: project.id,
    displayName: project.displayName,
    rootPath: project.rootPath,
    origin: project.origin ?? 'user',
  };
}

export function registerProjectRoutes(
  app: FastifyInstance,
  { projects }: ProjectRouteOptions,
): void {
  app.get('/v1/projects', async (): Promise<ProjectsResponse> => ({
    projects: projects.list().map(toSummary),
  }));

  app.get<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/tree',
    async (request, reply) => {
      try {
        const query = directoryQuerySchema.safeParse(request.query);
        if (!query.success) {
          return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid directory path.');
        }
        const entries = projects.listTree(request.params.projectId, query.data.path ?? '');
        const response: ListDirectoryResponse = { entries };
        return reply.send(listDirectoryResponseSchema.parse(response));
      } catch (error) {
        if (error instanceof ProjectPathError) {
          return sendError(request, reply, 400, 'PROJECT_PATH_INVALID', error.message);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { projectId: string }; Querystring: { path?: string } }>(
    '/v1/projects/:projectId/file',
    async (request, reply) => {
      const query = directoryQuerySchema.safeParse(request.query);
      if (!query.success || !query.data.path) {
        return sendError(request, reply, 400, 'VALIDATION_ERROR', 'A file path is required.');
      }
      try {
        return reply.send(projects.previewFile(request.params.projectId, query.data.path));
      } catch (error) {
        if (error instanceof ProjectPathError) {
          return sendError(request, reply, 400, 'PROJECT_PATH_INVALID', error.message);
        }
        throw error;
      }
    },
  );

  app.post('/v1/projects', async (request, reply) => {
    const body = createProjectRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid project request.');
    }
    try {
      const project = projects.addUserProject({
        displayName: body.data.displayName,
        parentProjectId: body.data.parentProjectId,
        folderName: body.data.folderName,
      });
      const response: CreateProjectResponse = {
        requestId: body.data.requestId,
        project: toSummary(project),
      };
      return reply.status(201).send(response);
    } catch (error) {
      if (error instanceof ProjectPathError) {
        return sendError(request, reply, 400, 'PROJECT_PATH_INVALID', error.message);
      }
      throw error;
    }
  });

  app.post<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/delete',
    async (request, reply) => {
      const params = projectParamsSchema.safeParse(request.params);
      const body = deleteProjectRequestSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid delete request.');
      }
      try {
        projects.remove(params.data.projectId);
        const response: DeleteProjectResponse = { requestId: body.data.requestId };
        return reply.send(deleteProjectResponseSchema.parse(response));
      } catch (error) {
        if (error instanceof ProjectPathError) {
          const code =
            error.code === 'CANNOT_DELETE_CONFIG_ROOT'
              ? 'CANNOT_DELETE_CONFIG_ROOT'
              : 'PROJECT_PATH_INVALID';
          return sendError(request, reply, 400, code, error.message);
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/files',
    async (request, reply) => {
      const params = projectParamsSchema.safeParse(request.params);
      const body = createProjectFileRequestSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid file request.');
      }
      try {
        const relativePath = projects.createFile(params.data.projectId, body.data.path);
        const response: CreateProjectFileResponse = {
          requestId: body.data.requestId,
          path: relativePath,
        };
        return reply.status(201).send(createProjectFileResponseSchema.parse(response));
      } catch (error) {
        if (error instanceof ProjectPathError) {
          return sendError(request, reply, 400, 'PROJECT_PATH_INVALID', error.message);
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { projectId: string } }>(
    '/v1/projects/:projectId/files/delete',
    async (request, reply) => {
      const params = projectParamsSchema.safeParse(request.params);
      const body = deleteProjectFileRequestSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendError(request, reply, 400, 'VALIDATION_ERROR', 'Invalid file delete request.');
      }
      try {
        const relativePath = projects.deleteFile(params.data.projectId, body.data.path);
        const response: DeleteProjectFileResponse = {
          requestId: body.data.requestId,
          path: relativePath,
        };
        return reply.send(deleteProjectFileResponseSchema.parse(response));
      } catch (error) {
        if (error instanceof ProjectPathError) {
          const code =
            error.code === 'CANNOT_DELETE_CONFIG_ROOT' || error.code === 'CANNOT_DELETE_HOME'
              ? error.code
              : 'PROJECT_PATH_INVALID';
          return sendError(request, reply, 400, code, error.message);
        }
        throw error;
      }
    },
  );
}
