import { describe, expect, it } from 'vitest';

import { closeDatabase, createDatabase } from '../client.js';

describe('model repository', () => {
  it('creates models, enforces a single active model, and resumes the active one', () => {
    const database = createDatabase(':memory:');
    const models = database.models;

    const first = models.create({
      id: 'model-1',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-v4-flash',
      apiKey: 'secret-1',
      isActive: true,
      createdAt: '2026-08-13T08:00:00.000Z',
    });
    models.create({
      id: 'model-2',
      name: 'Kimi',
      baseUrl: 'https://api.moonshot.cn/anthropic',
      model: 'kimi-k2',
      apiKey: 'secret-2',
      isActive: false,
      createdAt: '2026-08-13T08:01:00.000Z',
    });

    expect(first.isActive).toBe(true);
    expect(first.supportsImages).toBe(false);
    expect(models.list()).toHaveLength(2);
    expect(models.getActive()?.id).toBe('model-1');

    models.setActive('model-2');
    const active = models.getActive();
    expect(active?.id).toBe('model-2');
    expect(models.list().filter((m) => m.isActive)).toHaveLength(1);

    models.update('model-2', { supportsImages: true, supportsDocuments: true });
    expect(models.setMultimodalDefault('model-2')).toBe(true);
    expect(models.getMultimodalDefault()).toMatchObject({
      id: 'model-2',
      supportsImages: true,
      isMultimodalDefault: true,
    });
    expect(models.setMultimodalDefault('model-1')).toBe(false);

    models.delete('model-1');
    expect(models.list()).toHaveLength(1);
    expect(models.list()[0]?.id).toBe('model-2');

    closeDatabase(database);
  });

  it('keeps a single multimodal default and clears it when image support is disabled', () => {
    const database = createDatabase(':memory:');
    const models = database.models;
    for (const [id, createdAt] of [
      ['vision-1', '2026-08-13T08:00:00.000Z'],
      ['vision-2', '2026-08-13T08:01:00.000Z'],
    ] as const) {
      models.create({
        id,
        name: id,
        baseUrl: 'https://api.example.com',
        model: id,
        apiKey: 'secret',
        isActive: false,
        supportsImages: true,
        createdAt,
      });
    }

    expect(models.setMultimodalDefault('vision-1')).toBe(true);
    expect(models.setMultimodalDefault('vision-2')).toBe(true);
    expect(models.list().filter((model) => model.isMultimodalDefault)).toHaveLength(1);
    models.update('vision-2', { supportsImages: false });
    expect(models.getMultimodalDefault()).toBeNull();
    closeDatabase(database);
  });

  it('returns null for the active model when none exists', () => {
    const database = createDatabase(':memory:');
    expect(database.models.getActive()).toBeNull();
    closeDatabase(database);
  });

  it('returns false when setting a missing model active', () => {
    const database = createDatabase(':memory:');
    expect(database.models.setActive('missing')).toBe(false);
    closeDatabase(database);
  });
});
