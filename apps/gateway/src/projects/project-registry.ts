import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { ProjectRecord, ProjectRepository } from '@claude-chat/database';
import type { DirectoryNode } from '@claude-chat/protocol';

import type { GatewayProjectConfig } from '../config.js';
import {
  isPathContained,
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

  public resolveForExecution(id: string, relativePath: string | null = null): string {
    const rootPath = this.allowedRoots.get(id);
    if (!rootPath) {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project is not in the active configuration.');
    }

    if (!relativePath) return validateProjectDirectory(rootPath, [rootPath]);
    if (
      relativePath.includes('\0') ||
      relativePath.includes('\\') ||
      path.isAbsolute(relativePath)
    ) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Working directory must be a relative path inside the project root.',
      );
    }
    const segments = relativePath.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Working directory contains an invalid path segment.',
      );
    }
    return this.resolveProjectPath(id, relativePath, true);
  }

  public remove(projectId: string): void {
    const record = this.projects.list().find((candidate) => candidate.id === projectId);
    if (!record) {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project is not in the active configuration.');
    }
    if (record.origin === 'config') {
      throw new ProjectPathError(
        'CANNOT_DELETE_CONFIG_ROOT',
        'Configured project roots cannot be removed.',
      );
    }
    this.projects.delete(projectId);
    this.allowedRoots.delete(projectId);
  }

  public deleteFile(projectId: string, relativePath: string): string {
    const rootPath = this.allowedRoots.get(projectId);
    if (!rootPath) {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project is not in the active configuration.');
    }
    if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Path must stay within the project root.',
      );
    }

    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    if (
      segments.length === 0 ||
      segments.some((segment) => segment === '.' || segment === '..') ||
      segments.some((segment) => segment.toLowerCase() === 'home')
    ) {
      throw new ProjectPathError(
        'CANNOT_DELETE_HOME',
        'The home directory and its contents are protected from deletion.',
      );
    }

    const candidatePath = path.resolve(rootPath, relativePath);
    if (candidatePath === rootPath || !isPathContained(rootPath, candidatePath)) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Path must stay within the project root.',
      );
    }

    const parentRealPath = this.resolveParentForDeletion(rootPath, candidatePath);
    if (!isPathContained(rootPath, parentRealPath)) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Path is outside the configured project root.',
      );
    }
    try {
      lstatSync(candidatePath);
    } catch {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Requested path is unavailable.');
    }

    const protectedConfigRoot = this.projects
      .list()
      .find(
        (record) => record.origin === 'config' && isPathContained(candidatePath, record.rootPath),
      );
    if (protectedConfigRoot) {
      throw new ProjectPathError(
        'CANNOT_DELETE_CONFIG_ROOT',
        'Configured project roots cannot be deleted from the workspace.',
      );
    }

    rmSync(candidatePath, { force: false, recursive: true, maxRetries: 2 });
    for (const record of this.projects.list()) {
      if (record.origin === 'user' && isPathContained(candidatePath, record.rootPath)) {
        this.projects.delete(record.id);
        this.allowedRoots.delete(record.id);
      }
    }
    return path.relative(rootPath, candidatePath);
  }

  public createFile(projectId: string, relativePath: string): string {
    const rootPath = this.allowedRoots.get(projectId);
    if (!rootPath) {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project is not in the active configuration.');
    }
    if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Path must stay within the project root.',
      );
    }
    const segments = relativePath.split(/[\\/]+/);
    if (
      segments.some((segment) => !segment || segment === '.' || segment === '..') ||
      segments.some((segment) => segment.toLowerCase() === 'home')
    ) {
      throw new ProjectPathError('PATH_OUTSIDE_ALLOWED_ROOTS', 'File path is not allowed.');
    }

    const candidatePath = path.resolve(rootPath, ...segments);
    const parentRealPath = this.resolveParentForDeletion(rootPath, candidatePath);
    if (!isPathContained(rootPath, parentRealPath)) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Path is outside the configured project root.',
      );
    }
    try {
      writeFileSync(candidatePath, '', { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ProjectPathError('PATH_ALREADY_EXISTS', 'A file already exists at this path.');
      }
      throw error;
    }
    return path.relative(rootPath, candidatePath);
  }

  public listTree(projectId: string, relativePath = ''): DirectoryNode[] {
    const rootPath = this.allowedRoots.get(projectId);
    if (!rootPath) {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project is not in the active configuration.');
    }

    // Reverse lookup so a child directory that is already a registered project
    // surfaces its stable id directly, letting the client continue navigating.
    const projectIdByRoot = new Map<string, string>();
    for (const [id, root] of this.allowedRoots) {
      projectIdByRoot.set(root, id);
    }

    const directoryPath = this.resolveProjectPath(projectId, relativePath, true);
    const nodes: DirectoryNode[] = [];
    let dirents;
    try {
      dirents = readdirSync(directoryPath, { withFileTypes: true });
    } catch {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project directory is unavailable.');
    }

    for (const dirent of dirents) {
      const childPath = path.resolve(directoryPath, dirent.name);
      let childRealPath: string;
      try {
        childRealPath = realpathSync.native(childPath);
      } catch {
        continue;
      }
      if (!isPathContained(rootPath, childRealPath)) continue;
      const childRelativePath = path.relative(rootPath, childRealPath);
      nodes.push({
        name: dirent.name,
        path: childRealPath,
        relativePath: childRelativePath,
        isDirectory: dirent.isDirectory(),
        ...(dirent.isDirectory() ? { projectId: projectIdByRoot.get(childPath) } : {}),
      });
    }

    nodes.sort(
      (a, b) =>
        Number(b.isDirectory) - Number(a.isDirectory) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    );
    return nodes;
  }

  public previewFile(
    projectId: string,
    relativePath: string,
  ): {
    path: string;
    relativePath: string;
    content: string | null;
    reason: 'binary' | 'too_large' | null;
  } {
    const filePath = this.resolveProjectPath(projectId, relativePath, false);
    if (statSync(filePath).isDirectory()) {
      throw new ProjectPathError('PATH_MUST_BE_DIRECTORY', 'The requested path is a directory.');
    }
    const maxBytes = 512 * 1_024;
    if (statSync(filePath).size > maxBytes) {
      return { path: filePath, relativePath, content: null, reason: 'too_large' };
    }
    const bytes = readFileSync(filePath);
    if (bytes.includes(0)) return { path: filePath, relativePath, content: null, reason: 'binary' };
    return { path: filePath, relativePath, content: bytes.toString('utf8'), reason: null };
  }

  private resolveProjectPath(projectId: string, relativePath: string, directory: boolean): string {
    const rootPath = this.allowedRoots.get(projectId);
    if (!rootPath) {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Project is not in the active configuration.');
    }
    if (relativePath.includes('\0') || path.isAbsolute(relativePath)) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Path must stay within the project root.',
      );
    }
    const candidate = path.resolve(rootPath, relativePath || '.');
    let realPath: string;
    try {
      realPath = realpathSync.native(candidate);
    } catch {
      throw new ProjectPathError('PATH_NOT_FOUND', 'Requested path is unavailable.');
    }
    if (!isPathContained(rootPath, realPath)) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Path is outside the configured project root.',
      );
    }
    if (directory && !statSync(realPath).isDirectory()) {
      throw new ProjectPathError('PATH_MUST_BE_DIRECTORY', 'Requested path must be a directory.');
    }
    return realPath;
  }

  private resolveParentForDeletion(rootPath: string, candidatePath: string): string {
    const parentPath = path.dirname(candidatePath);
    let parentRealPath: string;
    try {
      parentRealPath = realpathSync.native(parentPath);
    } catch {
      throw new ProjectPathError('PATH_NOT_FOUND', 'The containing directory is unavailable.');
    }
    if (!isPathContained(rootPath, parentRealPath)) {
      throw new ProjectPathError(
        'PATH_OUTSIDE_ALLOWED_ROOTS',
        'Path is outside the configured project root.',
      );
    }
    return parentRealPath;
  }

  private rebuildAllowedRoots(): void {
    this.allowedRoots.clear();
    for (const record of this.projects.list()) {
      this.allowedRoots.set(record.id, record.rootPath);
    }
  }
}
