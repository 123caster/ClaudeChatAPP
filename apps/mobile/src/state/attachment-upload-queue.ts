export const MAX_ATTACHMENT_COUNT = 9;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DRAFT_BYTES = 40 * 1024 * 1024;

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const documentExtensions = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'jsonl',
  'csv',
  'tsv',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'java',
  'kt',
  'kts',
  'go',
  'rs',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'rb',
  'swift',
  'sql',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'vue',
  'svelte',
  'toml',
  'ini',
  'properties',
  'gradle',
  'groovy',
  'dart',
  'log',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
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

export type LocalAttachmentKind = 'image' | 'document';

export type AttachmentCandidate = {
  localId: string;
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  kind: LocalAttachmentKind;
};

export type ComposerAttachment = AttachmentCandidate & {
  status: 'queued' | 'uploading' | 'ready' | 'failed';
  progress: number;
  serverId?: string;
  error?: string;
};

export class AttachmentSelectionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AttachmentSelectionError';
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > -1 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isSupportedAttachment(candidate: AttachmentCandidate): boolean {
  const extension = extensionOf(candidate.name);
  if (candidate.kind === 'image') return imageExtensions.has(extension);
  return (
    documentExtensions.has(extension) || extensionlessTextNames.has(candidate.name.toLowerCase())
  );
}

export function validateAttachmentSelection(
  existing: readonly AttachmentCandidate[],
  incoming: readonly AttachmentCandidate[],
): AttachmentCandidate[] {
  if (existing.length + incoming.length > MAX_ATTACHMENT_COUNT) {
    throw new AttachmentSelectionError(`一次最多添加 ${MAX_ATTACHMENT_COUNT} 个附件。`);
  }

  const existingKeys = new Set(
    existing.map((item) => `${item.uri}\u0000${item.name}\u0000${item.size}`),
  );
  const accepted: AttachmentCandidate[] = [];
  for (const candidate of incoming) {
    const key = `${candidate.uri}\u0000${candidate.name}\u0000${candidate.size}`;
    if (existingKeys.has(key)) continue;
    if (!isSupportedAttachment(candidate)) {
      throw new AttachmentSelectionError(`不支持“${candidate.name}”的文件类型。`);
    }
    const limit = candidate.kind === 'image' ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
    if (candidate.size > limit) {
      const label = candidate.kind === 'image' ? '图片' : '文件';
      const megabytes = Math.round(limit / 1024 / 1024);
      throw new AttachmentSelectionError(`“${candidate.name}”超过${label} ${megabytes} MB 限制。`);
    }
    existingKeys.add(key);
    accepted.push(candidate);
  }

  const totalBytes = [...existing, ...accepted].reduce((sum, item) => sum + item.size, 0);
  if (totalBytes > MAX_DRAFT_BYTES) {
    throw new AttachmentSelectionError('本次提问的附件总大小不能超过 40 MB。');
  }
  return accepted;
}

export function readyAttachmentIds(items: readonly ComposerAttachment[]): string[] {
  return items.flatMap((item) => (item.status === 'ready' && item.serverId ? [item.serverId] : []));
}

export function hasUnfinishedAttachments(items: readonly ComposerAttachment[]): boolean {
  return items.some((item) => item.status !== 'ready');
}
