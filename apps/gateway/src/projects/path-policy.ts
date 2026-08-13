import { lstatSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export type ProjectPathErrorCode =
  | 'INVALID_PATH'
  | 'UNSUPPORTED_PATH_FORM'
  | 'ALLOWED_ROOT_MUST_NOT_BE_LINK'
  | 'PATH_NOT_FOUND'
  | 'PATH_MUST_BE_DIRECTORY'
  | 'PATH_OUTSIDE_ALLOWED_ROOTS';

export class ProjectPathError extends Error {
  public constructor(
    public readonly code: ProjectPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectPathError';
  }
}

const windowsPath = path.win32;

function parseRegularDrivePath(input: string): string {
  if (input.length === 0 || input.includes('\0')) {
    throw new ProjectPathError('INVALID_PATH', 'Project path is empty or contains a null byte.');
  }

  const normalizedSeparators = input.replaceAll('/', '\\');
  if (!/^[A-Za-z]:\\/.test(normalizedSeparators)) {
    throw new ProjectPathError(
      'UNSUPPORTED_PATH_FORM',
      'Only absolute Windows drive paths such as D:\\Projects\\app are supported.',
    );
  }

  return windowsPath.resolve(normalizedSeparators);
}

function resolveExistingDirectory(input: string): string {
  try {
    const realPath = realpathSync.native(parseRegularDrivePath(input));
    if (!statSync(realPath).isDirectory()) {
      throw new ProjectPathError('PATH_MUST_BE_DIRECTORY', 'Project path must be a directory.');
    }
    return realPath;
  } catch (error) {
    if (error instanceof ProjectPathError) {
      throw error;
    }
    throw new ProjectPathError('PATH_NOT_FOUND', 'Project path does not exist or is unavailable.');
  }
}

export function isPathContained(rootRealPath: string, candidateRealPath: string): boolean {
  const relative = windowsPath.relative(rootRealPath, candidateRealPath);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${windowsPath.sep}`) &&
      !windowsPath.isAbsolute(relative))
  );
}

export function prepareAllowedRoot(configuredRoot: string): string {
  const lexicalPath = parseRegularDrivePath(configuredRoot);

  try {
    if (lstatSync(lexicalPath).isSymbolicLink()) {
      throw new ProjectPathError(
        'ALLOWED_ROOT_MUST_NOT_BE_LINK',
        'An allowed project root cannot itself be a symbolic link or junction.',
      );
    }
  } catch (error) {
    if (error instanceof ProjectPathError) {
      throw error;
    }
    throw new ProjectPathError('PATH_NOT_FOUND', 'Allowed project root does not exist.');
  }

  return resolveExistingDirectory(lexicalPath);
}

export function validateProjectDirectory(
  candidate: string,
  allowedRootRealPaths: readonly string[],
): string {
  const candidateRealPath = resolveExistingDirectory(candidate);
  if (!allowedRootRealPaths.some((root) => isPathContained(root, candidateRealPath))) {
    throw new ProjectPathError(
      'PATH_OUTSIDE_ALLOWED_ROOTS',
      'Project path is outside the configured allowed roots.',
    );
  }
  return candidateRealPath;
}
