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
    expect(models.list()).toHaveLength(2);
    expect(models.getActive()?.id).toBe('model-1');

    models.setActive('model-2');
    const active = models.getActive();
    expect(active?.id).toBe('model-2');
    expect(models.list().filter((m) => m.isActive)).toHaveLength(1);

    models.delete('model-1');
    expect(models.list()).toHaveLength(1);
    expect(models.list()[0]?.id).toBe('model-2');

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
