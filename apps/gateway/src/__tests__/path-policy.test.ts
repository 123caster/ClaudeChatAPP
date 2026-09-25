import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectRecord, ProjectRepository } from '@claude-chat/database';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectRegistry } from '../projects/project-registry.js';
import {
  prepareAllowedRoot,
  ProjectPathError,
  resolveChildPath,
  validateProjectDirectory,
} from '../projects/path-policy.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'claude-chat-path-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe.skipIf(process.platform !== 'win32')('Windows project path policy', () => {
  it('accepts the allowed root and real child directories', () => {
    const root = temporaryDirectory();
    const child = join(root, 'apps', 'mobile');
    mkdirSync(child, { recursive: true });
    const preparedRoot = prepareAllowedRoot(root);

    expect(validateProjectDirectory(root, [preparedRoot])).toBe(preparedRoot);
    expect(
      validateProjectDirectory(join(root, 'apps', '..', 'apps', 'mobile'), [preparedRoot]),
    ).toBe(child);
  });

  it('rejects traversal, prefix collisions, non-absolute paths and files', () => {
    const parent = temporaryDirectory();
    const root = join(parent, 'project');
    const prefixCollision = join(parent, 'project-evil');
    mkdirSync(root);
    mkdirSync(prefixCollision);
    const file = join(root, 'README.md');
    writeFileSync(file, 'test');
    const preparedRoot = prepareAllowedRoot(root);

    expect(() => validateProjectDirectory(join(root, '..'), [preparedRoot])).toThrowError(
      ProjectPathError,
    );
    expect(() => validateProjectDirectory(prefixCollision, [preparedRoot])).toThrowError(
      ProjectPathError,
    );
    expect(() => validateProjectDirectory('project\\child', [preparedRoot])).toThrowError(
      ProjectPathError,
    );
    expect(() => validateProjectDirectory(file, [preparedRoot])).toThrowError(ProjectPathError);
  });

  it('rejects a junction that escapes the allowed root', () => {
    const root = temporaryDirectory();
    const outside = temporaryDirectory();
    const junction = join(root, 'outside-link');
    symlinkSync(outside, junction, 'junction');
    const preparedRoot = prepareAllowedRoot(root);

    expect(() => validateProjectDirectory(junction, [preparedRoot])).toThrowError(ProjectPathError);
  });

  it('revalidates the configured project before execution', () => {
    const parent = temporaryDirectory();
    const root = join(parent, 'project');
    const movedRoot = join(parent, 'project-moved');
    const outside = temporaryDirectory();
    mkdirSync(root);
    let records: ProjectRecord[] = [];
    const repository: ProjectRepository = {
      list: () => records,
      synchronize: (nextRecords) => {
        records = [...nextRecords];
      },
      upsert: (record) => {
        records = [record];
      },
      delete: () => false,
    };
    const registry = new ProjectRegistry(repository, () => new Date('2026-08-13T08:00:00Z'));
    const [project] = registry.synchronize([{ displayName: 'Project', path: root }]);

    expect(registry.resolveForExecution(project!.id)).toBe(root);
    renameSync(root, movedRoot);
    symlinkSync(outside, root, 'junction');
    expect(() => registry.resolveForExecution(project!.id)).toThrowError(ProjectPathError);
  });

  it('resolves a child path inside the root and rejects traversal or separators', () => {
    const root = temporaryDirectory();
    const preparedRoot = prepareAllowedRoot(root);

    expect(resolveChildPath(preparedRoot, 'new-project')).toBe(join(preparedRoot, 'new-project'));
    expect(() => resolveChildPath(preparedRoot, '..')).toThrowError(ProjectPathError);
    expect(() => resolveChildPath(preparedRoot, '../escape')).toThrowError(ProjectPathError);
    expect(() => resolveChildPath(preparedRoot, 'a/b')).toThrowError(ProjectPathError);
    expect(() => resolveChildPath(preparedRoot, 'a\\b')).toThrowError(ProjectPathError);
    expect(() => resolveChildPath(preparedRoot, '.')).toThrowError(ProjectPathError);
    expect(() => resolveChildPath(preparedRoot, '')).toThrowError(ProjectPathError);
    expect(() => resolveChildPath(preparedRoot, 'C:evil')).toThrowError(ProjectPathError);
  });

  it('addUserProject persists a user project and keeps it after re-synchronize', () => {
    const root = temporaryDirectory();
    let records: ProjectRecord[] = [];
    const repository: ProjectRepository = {
      list: () => records,
      synchronize: (nextRecords) => {
        const userRecords = records.filter((record) => record.origin === 'user');
        records = [
          ...userRecords,
          ...nextRecords.map((record) => ({ ...record, origin: 'config' as const })),
        ];
      },
      upsert: (record) => {
        records = [...records.filter((existing) => existing.rootPath !== record.rootPath), record];
      },
      delete: () => false,
    };
    const registry = new ProjectRegistry(repository, () => new Date('2026-08-13T08:00:00Z'));
    const [configured] = registry.synchronize([{ displayName: 'Root', path: root }]);

    const created = registry.addUserProject({
      displayName: 'New Project',
      parentProjectId: configured!.id,
      folderName: 'child',
    });

    expect(created.origin).toBe('user');
    expect(registry.resolveForExecution(created.id)).toBe(created.rootPath);

    registry.synchronize([{ displayName: 'Root', path: root }]);
    expect(registry.list().some((record) => record.id === created.id)).toBe(true);
  });

  it('deletes regular workspace content but preserves home and registered roots', () => {
    const root = temporaryDirectory();
    mkdirSync(join(root, 'home', 'notes'), { recursive: true });
    writeFileSync(join(root, 'home', 'notes', 'keep.txt'), 'protected');
    writeFileSync(join(root, 'delete-me.txt'), 'remove');
    let records: ProjectRecord[] = [];
    const repository: ProjectRepository = {
      list: () => records,
      synchronize: (nextRecords) => {
        const userRecords = records.filter((record) => record.origin === 'user');
        records = [...userRecords, ...nextRecords];
      },
      upsert: (record) => {
        records = [...records.filter((existing) => existing.id !== record.id), record];
      },
      delete: (id) => {
        const before = records.length;
        records = records.filter((record) => record.id !== id);
        return records.length !== before;
      },
    };
    const registry = new ProjectRegistry(repository, () => new Date('2026-08-13T08:00:00Z'));
    const [configured] = registry.synchronize([{ displayName: 'Root', path: root }]);
    const child = registry.addUserProject({
      displayName: 'Child',
      parentProjectId: configured!.id,
      folderName: 'child',
    });

    expect(registry.createFile(configured!.id, 'created.md')).toBe('created.md');
    expect(existsSync(join(root, 'created.md'))).toBe(true);
    expect(() => registry.createFile(configured!.id, 'created.md')).toThrowError(ProjectPathError);
    expect(() => registry.createFile(configured!.id, '../outside.md')).toThrowError(
      ProjectPathError,
    );

    expect(registry.deleteFile(configured!.id, 'delete-me.txt')).toBe('delete-me.txt');
    expect(existsSync(join(root, 'delete-me.txt'))).toBe(false);
    expect(() => registry.deleteFile(configured!.id, 'home')).toThrowError(ProjectPathError);
    expect(() => registry.deleteFile(configured!.id, 'home/notes/keep.txt')).toThrowError(
      ProjectPathError,
    );
    expect(() => registry.deleteFile(configured!.id, '../outside')).toThrowError(ProjectPathError);

    registry.deleteFile(configured!.id, 'child');
    expect(existsSync(child.rootPath)).toBe(false);
    expect(registry.list().some((record) => record.id === child.id)).toBe(false);
    expect(existsSync(join(root, 'home', 'notes', 'keep.txt'))).toBe(true);
  });
});
