import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProjectRecord, ProjectRepository } from '@claude-chat/database';
import { afterEach, describe, expect, it } from 'vitest';

import { ProjectRegistry } from '../projects/project-registry.js';
import {
  prepareAllowedRoot,
  ProjectPathError,
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
    };
    const registry = new ProjectRegistry(repository, () => new Date('2026-08-13T08:00:00Z'));
    const [project] = registry.synchronize([{ displayName: 'Project', path: root }]);

    expect(registry.resolveForExecution(project!.id)).toBe(root);
    renameSync(root, movedRoot);
    symlinkSync(outside, root, 'junction');
    expect(() => registry.resolveForExecution(project!.id)).toThrowError(ProjectPathError);
  });
});
