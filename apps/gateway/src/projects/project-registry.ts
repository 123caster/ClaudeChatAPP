import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';

import type { ProjectRecord, ProjectRepository } from '@claude-chat/database';

import type { GatewayProjectConfig } from '../config.js';
import {
  prepareAllowedRoot,
  ProjectPathError,
  resolveChildPath,
  validateProjectDirectory,
} from './path-policy.js';
import { writeScaffold } from './scaffold.js';

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
        origin: 'config' as const,
        createdAt: this.now().toISOString(),
      };
    });

    this.projects.synchronize(records);
    this.rebuildAllowedRoots();

    return this.projects.list();
  }

  public list(): ProjectRecord[] {
    return this.projects.list();
  }

  public addUserProject(input: {
    displayName: string;
    parentProjectId: string;
    folderName: string;
  }): ProjectRecord {
    const parentRoot = this.allowedRoots.get(input.parentProjectId);
    if (!parentRoot) {
      throw new ProjectPathError(
        'PATH_NOT_FOUND',
        'Parent project is not in the active configuration.',
      );
    }

    const rootPath = resolveChildPath(parentRoot, input.folderName);
    if (existsSync(rootPath)) {
      throw new ProjectPathError(
        'PATH_MUST_BE_DIRECTORY',
        'A folder with this name already exists.',
      );
    }

    mkdirSync(rootPath, { recursive: true });
    writeScaffold(rootPath, input.folderName);

    const record: ProjectRecord = {
      id: projectId(rootPath),
      displayName: input.displayName,
      rootPath,
      origin: 'user',
      createdAt: this.now().toISOString(),
    };
    this.projects.upsert(record);
    this.allowedRoots.set(record.id, record.rootPath);

    return record;
  }

  public resolveForExecution(id: string): string {
    const rootPath = this.allowedRoots.get(id);
    if (!rootPath) {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project is not in the active configuration.');
    }

    return validateProjectDirectory(rootPath, [rootPath]);
  }

  private rebuildAllowedRoots(): void {
    this.allowedRoots.clear();
    for (const record of this.projects.list()) {
      this.allowedRoots.set(record.id, record.rootPath);
    }
  }
}
