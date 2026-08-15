import {
  createProjectRequestSchema,
  type CreateProjectResponse,
  type ProjectsResponse,
} from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

import { sendError } from '../http-error.js';
import { ProjectPathError } from '../projects/path-policy.js';
import type { ProjectRegistry } from '../projects/project-registry.js';

type ProjectRouteOptions = {
  projects: ProjectRegistry;
};

function toSummary(project: { id: string; displayName: string; rootPath: string }) {
  return {
    id: project.id,
    displayName: project.displayName,
    rootPath: project.rootPath,
  };
}

export function registerProjectRoutes(
  app: FastifyInstance,
  { projects }: ProjectRouteOptions,
): void {
  app.get('/v1/projects', async (): Promise<ProjectsResponse> => ({
    projects: projects.list().map(toSummary),
  }));

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
}
