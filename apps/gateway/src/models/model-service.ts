import { randomUUID } from 'node:crypto';

import type {
  CreateModelRecord,
  ModelRepository,
  ModelRecord,
  SessionRepository,
} from '@claude-chat/database';
import type { ModelSummary } from '@claude-chat/protocol';

export class ModelNotFoundError extends Error {
  public constructor() {
    super('Model not found.');
    this.name = 'ModelNotFoundError';
  }
}

export class ModelInUseError extends Error {
  public constructor() {
    super('Model is still selected by one or more conversations.');
    this.name = 'ModelInUseError';
  }
}

export class ModelCapabilityError extends Error {
  public constructor() {
    super('The default multimodal model must support images.');
    this.name = 'ModelCapabilityError';
  }
}

export type ActiveModelConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsImages: boolean;
  supportsDocuments: boolean;
};

function toSummary(record: ModelRecord): ModelSummary {
  return {
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    model: record.model,
    isActive: record.isActive,
    supportsImages: record.supportsImages,
    supportsDocuments: record.supportsDocuments,
    isMultimodalDefault: record.isMultimodalDefault,
    createdAt: record.createdAt,
  };
}

export class ModelService {
  public constructor(
    private readonly models: ModelRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly sessions?: SessionRepository,
  ) {}

  public list(): ModelSummary[] {
    return this.models.list().map(toSummary);
  }

  public create(input: {
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    supportsImages?: boolean;
    supportsDocuments?: boolean;
    isMultimodalDefault?: boolean;
  }): ModelSummary {
    if (input.isMultimodalDefault && !input.supportsImages) {
      throw new ModelCapabilityError();
    }
    const isFirst = this.models.list().length === 0;
    const record: CreateModelRecord = {
      id: randomUUID(),
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
      isActive: isFirst,
      supportsImages: input.supportsImages,
      supportsDocuments: input.supportsDocuments,
      isMultimodalDefault: false,
      createdAt: this.now().toISOString(),
    };
    const created = this.models.create(record);
    if (input.isMultimodalDefault && !this.models.setMultimodalDefault(created.id)) {
      throw new ModelCapabilityError();
    }
    return toSummary(this.models.get(created.id)!);
  }

  public setActive(id: string): ModelSummary {
    if (!this.models.setActive(id)) {
      throw new ModelNotFoundError();
    }
    const record = this.models.list().find((candidate) => candidate.id === id);
    if (!record) {
      throw new ModelNotFoundError();
    }
    return toSummary(record);
  }

  public get(id: string): ActiveModelConfig | null {
    const record = this.models.get(id);
    if (!record) return null;
    return {
      id: record.id,
      baseUrl: record.baseUrl,
      apiKey: record.apiKey,
      model: record.model,
      supportsImages: record.supportsImages,
      supportsDocuments: record.supportsDocuments,
    };
  }

  public createVariant(sourceId: string, model: string): ModelSummary {
    const source = this.models.get(sourceId);
    if (!source) throw new ModelNotFoundError();
    const record: CreateModelRecord = {
      ...source,
      id: randomUUID(),
      model,
      isActive: false,
      isMultimodalDefault: false,
      createdAt: this.now().toISOString(),
    };
    return toSummary(this.models.create(record));
  }

  public createVariants(sourceId: string, modelNames: string[]): ModelSummary[] {
    return modelNames.map((model) => this.createVariant(sourceId, model));
  }

  public update(
    id: string,
    input: Partial<
      Pick<
        ModelRecord,
        | 'name'
        | 'baseUrl'
        | 'apiKey'
        | 'model'
        | 'supportsImages'
        | 'supportsDocuments'
        | 'isMultimodalDefault'
      >
    >,
  ): ModelSummary {
    const existing = this.models.get(id);
    if (!existing) throw new ModelNotFoundError();
    if (input.isMultimodalDefault && !(input.supportsImages ?? existing.supportsImages)) {
      throw new ModelCapabilityError();
    }
    const { isMultimodalDefault, ...changes } = input;
    const updated = this.models.update(id, changes);
    if (!updated) throw new ModelNotFoundError();
    if (isMultimodalDefault === true && !this.models.setMultimodalDefault(id)) {
      throw new ModelCapabilityError();
    }
    if (isMultimodalDefault === false) {
      this.models.clearMultimodalDefault(id);
    }
    return toSummary(this.models.get(id)!);
  }

  public setMultimodalDefault(id: string): ModelSummary {
    if (!this.models.get(id)) throw new ModelNotFoundError();
    if (!this.models.setMultimodalDefault(id)) throw new ModelCapabilityError();
    return toSummary(this.models.get(id)!);
  }

  public delete(id: string): void {
    if (this.sessions?.list({ includeArchived: true }).some((session) => session.modelId === id)) {
      throw new ModelInUseError();
    }
    if (!this.models.delete(id)) {
      throw new ModelNotFoundError();
    }
  }

  public getActive(): ActiveModelConfig | null {
    const record = this.models.getActive();
    if (!record) return null;
    return {
      id: record.id,
      baseUrl: record.baseUrl,
      apiKey: record.apiKey,
      model: record.model,
      supportsImages: record.supportsImages,
      supportsDocuments: record.supportsDocuments,
    };
  }

  public getMultimodalDefault(): ActiveModelConfig | null {
    const record = this.models.getMultimodalDefault();
    if (!record) return null;
    return {
      id: record.id,
      baseUrl: record.baseUrl,
      apiKey: record.apiKey,
      model: record.model,
      supportsImages: record.supportsImages,
      supportsDocuments: record.supportsDocuments,
    };
  }

  public getActiveModelId(): string | null {
    return this.models.getActive()?.id ?? null;
  }
}
