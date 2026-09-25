import { isUtf8 } from 'node:buffer';
import { extname } from 'node:path';

import { fileTypeFromBuffer } from 'file-type';

export const MAX_ATTACHMENT_COUNT = 9;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DRAFT_BYTES = 40 * 1024 * 1024;

const imageTypes = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

const officeTypes = new Map([
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
]);

const textExtensions = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.csv',
  '.tsv',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.py',
  '.java',
  '.kt',
  '.kts',
  '.go',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.swift',
  '.sql',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.svelte',
  '.toml',
  '.ini',
  '.properties',
  '.gradle',
  '.groovy',
  '.dart',
  '.log',
]);

const extensionlessTextNames = new Set([
  'dockerfile',
  'makefile',
  'readme',
  'license',
  'notice',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
]);

export type InspectedAttachment = {
  kind: 'image' | 'document';
  mimeType: string;
  extension: string;
};

export class AttachmentPolicyError extends Error {
  public constructor(
    public readonly reason: 'unsupported' | 'too_large',
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentPolicyError';
  }
}

function validateName(name: string): string {
  const trimmed = name.trim();
  const containsControlCharacter = [...trimmed].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (
    trimmed.length === 0 ||
    trimmed.length > 240 ||
    trimmed !== name ||
    /[\\/]/.test(trimmed) ||
    containsControlCharacter
  ) {
    throw new AttachmentPolicyError('unsupported', 'The attachment name is invalid.');
  }
  return trimmed;
}

function isTextName(name: string, extension: string): boolean {
  return textExtensions.has(extension) || extensionlessTextNames.has(name.toLowerCase());
}

function assertDeclaredMimeCompatible(declaredMimeType: string, actualMimeType: string): void {
  const declared = declaredMimeType.trim().toLowerCase().split(';', 1)[0];
  if (!declared || declared === 'application/octet-stream') return;
  if (declared === actualMimeType) return;
  if (
    actualMimeType === 'text/plain' &&
    (declared.startsWith('text/') || declared.endsWith('+json'))
  ) {
    return;
  }
  throw new AttachmentPolicyError('unsupported', 'The declared attachment type is inconsistent.');
}

export async function inspectAttachment(input: {
  name: string;
  declaredMimeType: string;
  data: Buffer;
}): Promise<InspectedAttachment> {
  const name = validateName(input.name);
  const extension = extname(name).toLowerCase();
  const detected = await fileTypeFromBuffer(input.data);

  const imageMime = imageTypes.get(extension);
  if (imageMime) {
    if (input.data.length > MAX_IMAGE_BYTES) {
      throw new AttachmentPolicyError('too_large', 'Images may not exceed 10 MB.');
    }
    if (!detected || detected.mime !== imageMime) {
      throw new AttachmentPolicyError('unsupported', 'The image bytes do not match its file name.');
    }
    assertDeclaredMimeCompatible(input.declaredMimeType, imageMime);
    return { kind: 'image', mimeType: imageMime, extension };
  }

  if (input.data.length > MAX_DOCUMENT_BYTES) {
    throw new AttachmentPolicyError('too_large', 'Files may not exceed 20 MB.');
  }

  if (extension === '.pdf') {
    if (detected?.mime !== 'application/pdf') {
      throw new AttachmentPolicyError('unsupported', 'The PDF bytes do not match its file name.');
    }
    assertDeclaredMimeCompatible(input.declaredMimeType, 'application/pdf');
    return { kind: 'document', mimeType: 'application/pdf', extension };
  }

  const officeMime = officeTypes.get(extension);
  if (officeMime) {
    if (detected?.ext !== extension.slice(1)) {
      throw new AttachmentPolicyError(
        'unsupported',
        'The Office document bytes do not match its file name.',
      );
    }
    assertDeclaredMimeCompatible(input.declaredMimeType, officeMime);
    return { kind: 'document', mimeType: officeMime, extension };
  }

  if (isTextName(name, extension)) {
    if (detected || !isUtf8(input.data) || input.data.includes(0)) {
      throw new AttachmentPolicyError('unsupported', 'The selected file is not valid UTF-8 text.');
    }
    assertDeclaredMimeCompatible(input.declaredMimeType, 'text/plain');
    return { kind: 'document', mimeType: 'text/plain', extension };
  }

  throw new AttachmentPolicyError('unsupported', 'This attachment type is not supported.');
}
