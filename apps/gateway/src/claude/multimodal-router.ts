import Anthropic from '@anthropic-ai/sdk';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AttachmentRecord } from '@claude-chat/database';

import {
  AttachmentContentService,
  type LoadedImage,
} from '../attachments/attachment-content-service.js';
import { AttachmentError } from '../attachments/attachment-service.js';

export type MultimodalModelConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsImages: boolean;
  supportsDocuments: boolean;
};

export type MultimodalModelLookup = {
  getMultimodalDefault(): MultimodalModelConfig | null;
};

export type ImageIdentifier = (
  model: MultimodalModelConfig,
  question: string,
  images: readonly LoadedImage[],
) => Promise<string>;

export type MultimodalProviderDiagnostic = {
  event: 'multimodal.provider-failure';
  attempt: number;
  durationMs: number;
  modelId: string;
  model: string;
  imageCount: number;
  images: Array<{
    attachmentId: string;
    originalBytes: number;
    normalizedBytes: number;
    width: number;
    height: number;
  }>;
  errorName: string;
  status?: number;
  providerCode?: string;
  retryable: boolean;
};

export type MultimodalDiagnosticSink = (diagnostic: MultimodalProviderDiagnostic) => void;

async function identifyImagesWithAnthropic(
  model: MultimodalModelConfig,
  question: string,
  images: readonly LoadedImage[],
): Promise<string> {
  const client = new Anthropic({
    apiKey: null,
    authToken: model.apiKey,
    baseURL: model.baseUrl,
  });
  const response = await client.messages.create({
    model: model.model,
    max_tokens: 4_096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              '请逐张识别以下图片，并返回结构化、忠实、可供另一个模型继续回答的说明。' +
              `\n原始问题：${question || '用户未输入文字，只提交了图片。'}` +
              `\n图片名称：${images.map((image) => image.name).join('、')}`,
          },
          ...images.map((image) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: image.mediaType,
              data: image.data,
            },
          })),
        ],
      },
    ],
  });
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('The multimodal model returned no text.');
  return text;
}

type ProviderFailure = {
  errorName: string;
  status?: number;
  providerCode?: string;
  retryable: boolean;
};

const CONNECTION_ERROR_NAMES = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'AbortError',
  'TimeoutError',
]);
const CONNECTION_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function safeProviderCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) return undefined;
  return value;
}

function describeProviderFailure(error: unknown): ProviderFailure {
  const failure = recordValue(error);
  const cause = recordValue(failure?.cause);
  const responseError = recordValue(failure?.error);
  const errorName = error instanceof Error ? error.name : 'UnknownProviderError';
  const status = typeof failure?.status === 'number' ? failure.status : undefined;
  const providerCode =
    safeProviderCode(failure?.code) ??
    safeProviderCode(responseError?.code) ??
    safeProviderCode(cause?.code);
  const retryable =
    status === 429 ||
    (status !== undefined && status >= 500 && status <= 599) ||
    CONNECTION_ERROR_NAMES.has(errorName) ||
    (providerCode !== undefined && CONNECTION_ERROR_CODES.has(providerCode));
  return {
    errorName,
    ...(status === undefined ? {} : { status }),
    ...(providerCode === undefined ? {} : { providerCode }),
    retryable,
  };
}

function recognitionPrompt(question: string, recognition: string): string {
  const original = question.trim() || '请根据图片识别结果回答。';
  return `${original}\n\n<image-recognition source="default-multimodal-model">\n${recognition}\n</image-recognition>`;
}

export class MultimodalRouter {
  public constructor(
    private readonly content: AttachmentContentService,
    private readonly models: MultimodalModelLookup,
    private readonly identifyImages: ImageIdentifier = identifyImagesWithAnthropic,
    private readonly diagnosticSink: MultimodalDiagnosticSink = () => undefined,
  ) {}

  public assertConfigured(
    attachments: readonly AttachmentRecord[],
    currentModel: MultimodalModelConfig | null,
  ): void {
    const hasImages = attachments.some((attachment) => attachment.kind === 'image');
    if (!hasImages || currentModel === null || currentModel.supportsImages) return;
    if (this.models.getMultimodalDefault()) return;

    throw new AttachmentError(
      503,
      'MULTIMODAL_MODEL_UNAVAILABLE',
      'Configure a default multimodal model before sending images to this model.',
    );
  }

  public async prepare(
    question: string,
    attachments: readonly AttachmentRecord[],
    currentModel: MultimodalModelConfig | null,
  ): Promise<string | AsyncIterable<SDKUserMessage>> {
    if (attachments.length === 0) return question;
    this.assertConfigured(attachments, currentModel);
    const images = attachments.filter((attachment) => attachment.kind === 'image');
    const nativeAgentModel = currentModel === null;
    const supportsImages = nativeAgentModel || currentModel.supportsImages;
    const supportsDocuments = nativeAgentModel || currentModel.supportsDocuments;

    if (images.length > 0 && !supportsImages) {
      const fallback = this.models.getMultimodalDefault();
      if (!fallback) {
        throw new AttachmentError(
          503,
          'MULTIMODAL_MODEL_UNAVAILABLE',
          'Configure a default multimodal model before sending images to this model.',
        );
      }
      const recognition = await this.identifyWithRetry(
        fallback,
        question,
        await this.content.loadImages(images),
      );
      return this.content.buildPrompt(recognitionPrompt(question, recognition), attachments, {
        includeImages: false,
        directPdf: supportsDocuments,
      });
    }

    return this.content.buildPrompt(question, attachments, {
      includeImages: true,
      directPdf: supportsDocuments,
    });
  }

  private async identifyWithRetry(
    model: MultimodalModelConfig,
    question: string,
    images: readonly LoadedImage[],
  ): Promise<string> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const startedAt = Date.now();
      try {
        return await this.identifyImages(model, question, images);
      } catch (error) {
        const failure = describeProviderFailure(error);
        this.diagnosticSink({
          event: 'multimodal.provider-failure',
          attempt,
          durationMs: Date.now() - startedAt,
          modelId: model.id,
          model: model.model,
          imageCount: images.length,
          images: images.map((image) => ({
            attachmentId: image.attachmentId,
            originalBytes: image.originalBytes,
            normalizedBytes: image.normalizedBytes,
            width: image.width,
            height: image.height,
          })),
          ...failure,
        });
        if (attempt === 1 && failure.retryable) continue;
        throw new AttachmentError(
          503,
          'MULTIMODAL_MODEL_UNAVAILABLE',
          failure.retryable
            ? 'The configured multimodal model is temporarily unavailable. Please retry.'
            : 'The configured multimodal model could not process the selected images.',
          failure.retryable,
        );
      }
    }
    throw new Error('Unreachable multimodal retry state.');
  }
}
