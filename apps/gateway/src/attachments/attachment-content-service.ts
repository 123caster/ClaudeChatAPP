import { extname } from 'node:path';

import type { AttachmentRecord } from '@claude-chat/database';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { OfficeParser, type SupportedFileType } from 'officeparser';
import sharp from 'sharp';

import { AttachmentError } from './attachment-service.js';

type MessageContent = Exclude<SDKUserMessage['message']['content'], string>;
type MessageContentBlock = MessageContent[number];

export type AttachmentOriginalReader = {
  readOriginal(record: AttachmentRecord): Buffer;
};

export type LoadedImage = {
  attachmentId: string;
  name: string;
  mediaType: 'image/jpeg';
  data: string;
  originalBytes: number;
  normalizedBytes: number;
  width: number;
  height: number;
};

export type BuildAttachmentPromptOptions = {
  includeImages: boolean;
  directPdf: boolean;
};

const MAX_EXTRACTED_CHARACTERS_PER_FILE = 100_000;
const MAX_EXTRACTED_CHARACTERS_TOTAL = 240_000;
const MAX_MODEL_IMAGE_EDGE = 1_600;
const MODEL_IMAGE_QUALITY = 85;
const MAX_MODEL_IMAGE_PIXELS = 40_000_000;

function escapeBoundaryValue(value: string): string {
  return value.replace(/[<&"]/g, (character) => {
    if (character === '<') return '&lt;';
    if (character === '&') return '&amp;';
    return '&quot;';
  });
}

function attachmentText(record: AttachmentRecord, text: string): string {
  const bounded = text.slice(0, MAX_EXTRACTED_CHARACTERS_PER_FILE);
  const suffix = text.length > bounded.length ? '\n\n[内容过长，已截断]' : '';
  return `<attachment name="${escapeBoundaryValue(record.name)}" type="${escapeBoundaryValue(record.mimeType)}">\n${bounded}${suffix}\n</attachment>`;
}

function structuredPrompt(blocks: MessageContent): AsyncIterable<SDKUserMessage> {
  return (async function* (): AsyncIterable<SDKUserMessage> {
    yield {
      type: 'user',
      message: { role: 'user', content: blocks },
      parent_tool_use_id: null,
    };
  })();
}

function assertImageMediaType(record: AttachmentRecord): void {
  if (
    record.mimeType === 'image/jpeg' ||
    record.mimeType === 'image/png' ||
    record.mimeType === 'image/gif' ||
    record.mimeType === 'image/webp'
  ) {
    return;
  }
  throw new AttachmentError(415, 'ATTACHMENT_TYPE_UNSUPPORTED', `${record.name} is not an image.`);
}

export class AttachmentContentService {
  public constructor(private readonly originals: AttachmentOriginalReader) {}

  public async loadImages(records: readonly AttachmentRecord[]): Promise<LoadedImage[]> {
    return Promise.all(
      records
        .filter((record) => record.kind === 'image')
        .map(async (record) => this.prepareImage(record)),
    );
  }

  public async buildPrompt(
    text: string,
    records: readonly AttachmentRecord[],
    options: BuildAttachmentPromptOptions,
  ): Promise<string | AsyncIterable<SDKUserMessage>> {
    if (records.length === 0) return text;
    const blocks: MessageContentBlock[] = [];
    if (text.trim()) blocks.push({ type: 'text', text });
    let extractedCharacters = 0;
    const loadedImages = options.includeImages ? await this.loadImages(records) : [];
    const imagesById = new Map(loadedImages.map((image) => [image.attachmentId, image]));

    for (const record of records) {
      if (record.kind === 'image') {
        if (!options.includeImages) continue;
        const image = imagesById.get(record.id)!;
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.data },
        });
        continue;
      }

      const original = this.originals.readOriginal(record);
      if (record.mimeType === 'application/pdf' && options.directPdf) {
        blocks.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: original.toString('base64'),
          },
          title: record.name,
        });
        continue;
      }

      const extracted = await this.extractText(record, original);
      if (extractedCharacters + extracted.length > MAX_EXTRACTED_CHARACTERS_TOTAL) {
        throw new AttachmentError(
          422,
          'DOCUMENT_PARSE_FAILED',
          'The extracted document content is too large for one question.',
        );
      }
      extractedCharacters += extracted.length;
      blocks.push({ type: 'text', text: attachmentText(record, extracted) });
    }

    if (blocks.length === 0) {
      throw new AttachmentError(
        422,
        'DOCUMENT_PARSE_FAILED',
        'No readable attachment content was found.',
      );
    }
    return structuredPrompt(blocks);
  }

  private async prepareImage(record: AttachmentRecord): Promise<LoadedImage> {
    assertImageMediaType(record);
    const original = this.originals.readOriginal(record);
    try {
      const normalized = await sharp(original, {
        animated: false,
        failOn: 'warning',
        limitInputPixels: MAX_MODEL_IMAGE_PIXELS,
      })
        .rotate()
        .resize({
          width: MAX_MODEL_IMAGE_EDGE,
          height: MAX_MODEL_IMAGE_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: MODEL_IMAGE_QUALITY, chromaSubsampling: '4:2:0' })
        .toBuffer({ resolveWithObject: true });
      return {
        attachmentId: record.id,
        name: record.name,
        mediaType: 'image/jpeg',
        data: normalized.data.toString('base64'),
        originalBytes: original.length,
        normalizedBytes: normalized.info.size,
        width: normalized.info.width,
        height: normalized.info.height,
      };
    } catch {
      throw new AttachmentError(
        422,
        'ATTACHMENT_TYPE_UNSUPPORTED',
        `${record.name} could not be prepared for image recognition.`,
      );
    }
  }

  private async extractText(record: AttachmentRecord, original: Buffer): Promise<string> {
    if (record.mimeType === 'text/plain') {
      return original.toString('utf8');
    }
    const fileType = extname(record.name).slice(1).toLowerCase() as SupportedFileType;
    try {
      const ast = await OfficeParser.parseOffice(new Uint8Array(original), {
        fileType,
        extractAttachments: false,
        includeRawContent: false,
        ocr: false,
        decompressionLimits: {
          maxUncompressedBytes: 64 * 1024 * 1024,
          maxZipEntries: 2_000,
          maxTableCells: 100_000,
        },
      });
      const text = ast.toText().trim();
      if (!text) {
        throw new Error('Document contains no extractable text.');
      }
      return text;
    } catch {
      throw new AttachmentError(
        422,
        'DOCUMENT_PARSE_FAILED',
        `${record.name} could not be read safely.`,
      );
    }
  }
}
