import type { ProjectsResponse } from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

import { createAuthenticationHook } from '../auth/authenticate.js';
import type { DeviceAuthService } from '../auth/device-auth-service.js';
import type { ProjectRegistry } from '../projects/project-registry.js';

type ProjectRouteOptions = {
  deviceAuth: DeviceAuthService;
  projects: ProjectRegistry;
};

export function registerProjectRoutes(
  app: FastifyInstance,
  { deviceAuth, projects }: ProjectRouteOptions,
): void {
  app.get(
    '/v1/projects',
    { preHandler: createAuthenticationHook(deviceAuth) },
    async (): Promise<ProjectsResponse> => ({
      projects: projects.list().map((project) => ({
        id: project.id,
        displayName: project.displayName,
        rootPath: project.rootPath,
      })),
    }),
  );
}
