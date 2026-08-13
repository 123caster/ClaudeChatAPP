import { createHash } from 'node:crypto';

import type { ProjectRecord, ProjectRepository } from '@claude-chat/database';

import type { GatewayProjectConfig } from '../config.js';
import { prepareAllowedRoot, ProjectPathError, validateProjectDirectory } from './path-policy.js';

function projectId(rootPath: string): string {
  const digest = createHash('sha256').update(rootPath.toLowerCase()).digest('hex').slice(0, 24);
  return `project_${digest}`;
}

export class ProjectRegistry {
  private readonly allowedRoots = new Map<string, string>();

  public constructor(
    private readonly projects: ProjectRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public synchronize(configuredProjects: readonly GatewayProjectConfig[]): ProjectRecord[] {
    const records = configuredProjects.map((configuredProject) => {
      const rootPath = prepareAllowedRoot(configuredProject.path);
      return {
        id: projectId(rootPath),
        displayName: configuredProject.displayName,
        rootPath,
        createdAt: this.now().toISOString(),
      };
    });

    this.projects.synchronize(records);
    this.allowedRoots.clear();
    for (const record of records) {
      this.allowedRoots.set(record.id, record.rootPath);
    }

    return this.projects.list();
  }

  public list(): ProjectRecord[] {
    return this.projects.list();
  }

  public resolveForExecution(id: string): string {
    const rootPath = this.allowedRoots.get(id);
    if (!rootPath) {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project is not in the active configuration.');
    }

    return validateProjectDirectory(rootPath, [rootPath]);
  }
}
