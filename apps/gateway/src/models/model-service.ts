import { randomUUID } from 'node:crypto';

import type { ModelRepository, ModelRecord } from '@claude-chat/database';
import type { ModelSummary } from '@claude-chat/protocol';

export class ModelNotFoundError extends Error {
  public constructor() {
    super('Model not found.');
    this.name = 'ModelNotFoundError';
  }
}

export type ActiveModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

function toSummary(record: ModelRecord): ModelSummary {
  return {
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    model: record.model,
    isActive: record.isActive,
    createdAt: record.createdAt,
  };
}

export class ModelService {
  public constructor(
    private readonly models: ModelRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public list(): ModelSummary[] {
    return this.models.list().map(toSummary);
  }

  public create(input: { name: string; baseUrl: string; apiKey: string; model: string }): ModelSummary {
    const isFirst = this.models.list().length === 0;
    const record: ModelRecord = {
      id: randomUUID(),
      name: input.name,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
      isActive: isFirst,
      createdAt: this.now().toISOString(),
    };
    return toSummary(this.models.create(record));
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

  public delete(id: string): void {
    if (!this.models.delete(id)) {
      throw new ModelNotFoundError();
    }
  }

  public getActive(): ActiveModelConfig | null {
    const record = this.models.getActive();
    if (!record) return null;
    return {
      baseUrl: record.baseUrl,
      apiKey: record.apiKey,
      model: record.model,
    };
  }
}
