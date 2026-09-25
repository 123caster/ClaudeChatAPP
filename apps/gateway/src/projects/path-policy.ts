import { lstatSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export type ProjectPathErrorCode =
  | 'INVALID_PATH'
  | 'UNSUPPORTED_PATH_FORM'
  | 'ALLOWED_ROOT_MUST_NOT_BE_LINK'
  | 'PATH_NOT_FOUND'
  | 'PATH_MUST_BE_DIRECTORY'
  | 'PATH_OUTSIDE_ALLOWED_ROOTS'
  | 'PATH_ALREADY_EXISTS'
  | 'INVALID_CHILD_NAME'
  | 'CANNOT_DELETE_CONFIG_ROOT'
  | 'CANNOT_DELETE_HOME';

export class ProjectPathError extends Error {
  public constructor(
    public readonly code: ProjectPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectPathError';
  }
}

const pathImplementation = process.platform === 'win32' ? path.win32 : path.posix;

function parseRegularDrivePath(input: string): string {
  if (input.length === 0 || input.includes('\0')) {
    throw new ProjectPathError('INVALID_PATH', 'Project path is empty or contains a null byte.');
  }

  const isWindowsStyle = /^[A-Za-z]:\\/.test(input.replaceAll('/', '\\'));
  const isPosixStyle = input.startsWith('/');

  if (!isWindowsStyle && !isPosixStyle) {
    throw new ProjectPathError(
      'UNSUPPORTED_PATH_FORM',
      'Only absolute paths are supported (e.g. D:\\Projects\\app on Windows or /srv/app on Unix).',
    );
  }

  const normalized = isWindowsStyle ? input.replaceAll('/', '\\') : input;
  return pathImplementation.resolve(normalized);
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
  const relative = pathImplementation.relative(rootRealPath, candidateRealPath);
  return (
    relative === '' ||
    (relative !== '..' &&
      !relative.startsWith(`..${pathImplementation.sep}`) &&
      !pathImplementation.isAbsolute(relative))
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

export function sanitizeChildName(childName: string): string {
  const trimmed = childName.trim();
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('\0') ||
    /[\\/:*?"<>|]/.test(trimmed) ||
    /^[A-Za-z]:/.test(trimmed)
  ) {
    throw new ProjectPathError(
      'INVALID_CHILD_NAME',
      'Folder name must be a single directory name without path separators or drive letters.',
    );
  }
  return trimmed;
}

export function resolveChildPath(allowedRootRealPath: string, childName: string): string {
  const safeName = sanitizeChildName(childName);
  const candidate = pathImplementation.resolve(
    pathImplementation.join(allowedRootRealPath, safeName),
  );
  if (candidate === allowedRootRealPath || !isPathContained(allowedRootRealPath, candidate)) {
    throw new ProjectPathError(
      'PATH_OUTSIDE_ALLOWED_ROOTS',
      'New folder resolves outside the allowed root.',
    );
  }
  return candidate;
}
