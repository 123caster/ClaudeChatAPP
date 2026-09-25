import { closeDatabase, createDatabase, type DatabaseClient } from '@claude-chat/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { ModelService } from '../models/model-service.js';
import { ProjectRegistry } from '../projects/project-registry.js';

type TestContext = {
  app: FastifyInstance;
  database: DatabaseClient;
};
const contexts: TestContext[] = [];

function createContext(apiKey?: string): TestContext {
  const database = createDatabase(':memory:');
  const projects = new ProjectRegistry(database.projects);
  const models = new ModelService(
    database.models,
    () => new Date('2026-08-13T08:00:00Z'),
    database.sessions,
  );
  const app = buildApp({ apiKey, services: { projects, models } });

  const context = { app, database };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.app.close();
    closeDatabase(context.database);
  }
});

describe('model management routes', () => {
  it('creates a model, makes it active, and never exposes the api key', async () => {
    const { app } = createContext('top-secret-key');
    const key = 'top-secret-key';

    const created = await app.inject({
      method: 'POST',
      url: '/v1/models',
      headers: { 'x-api-key': key },
      payload: {
        requestId: 'create-model-1',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-secret-token',
        model: 'deepseek-v4-flash',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody.model).toMatchObject({ name: 'DeepSeek', isActive: true });
    expect(JSON.stringify(createdBody)).not.toContain('sk-secret-token');

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: { 'x-api-key': key },
    });
    const { models: list } = listed.json() as { models: { id: string; name: string }[] };
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain('sk-secret-token');
  });

  it('switches the active model and deletes a model', async () => {
    const { app } = createContext(undefined);

    const first = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: {
        requestId: 'create-a',
        name: 'A',
        baseUrl: 'https://a.example/anthropic',
        apiKey: 'key-a',
        model: 'model-a',
      },
    });
    const firstId = (first.json() as { model: { id: string } }).model.id;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: {
        requestId: 'create-b',
        name: 'B',
        baseUrl: 'https://b.example/anthropic',
        apiKey: 'key-b',
        model: 'model-b',
      },
    });
    const secondId = (second.json() as { model: { id: string } }).model.id;

    const switched = await app.inject({
      method: 'POST',
      url: `/v1/models/${secondId}/active`,
      payload: { requestId: 'switch-active' },
    });
    expect(switched.statusCode).toBe(200);
    expect((switched.json() as { model: { id: string; isActive: boolean } }).model).toMatchObject({
      id: secondId,
      isActive: true,
    });

    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/models/${firstId}/delete`,
      payload: { requestId: 'delete-a' },
    });
    expect(deleted.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/v1/models' });
    const { models } = list.json() as { models: { id: string }[] };
    expect(models.map((m) => m.id)).toEqual([secondId]);
  });

  it('adds another model under an existing API configuration without exposing its key', async () => {
    const { app } = createContext(undefined);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: {
        requestId: 'create-provider',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-provider-secret',
        model: 'deepseek-chat',
      },
    });
    const sourceId = (created.json() as { model: { id: string } }).model.id;

    const variant = await app.inject({
      method: 'POST',
      url: `/v1/models/${sourceId}/variants`,
      payload: { requestId: 'create-variant', model: 'deepseek-reasoner' },
    });
    expect(variant.statusCode).toBe(201);
    expect(variant.json()).toMatchObject({
      model: { name: 'DeepSeek', model: 'deepseek-reasoner' },
    });
    expect(variant.body).not.toContain('sk-provider-secret');

    const list = await app.inject({ method: 'GET', url: '/v1/models' });
    expect((list.json() as { models: unknown[] }).models).toHaveLength(2);
  });

  it('batch creates variants and updates a model without exposing the API key', async () => {
    const { app } = createContext(undefined);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: {
        requestId: 'create-batch-source',
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        apiKey: 'sk-secret',
        model: 'deepseek-chat',
      },
    });
    const sourceId = (created.json() as { model: { id: string } }).model.id;

    const batch = await app.inject({
      method: 'POST',
      url: `/v1/models/${sourceId}/variants/batch`,
      payload: { requestId: 'create-batch-variants', models: ['deepseek-reasoner', 'deepseek-v4'] },
    });
    expect(batch.statusCode).toBe(201);
    expect(batch.json()).toMatchObject({
      models: [{ model: 'deepseek-reasoner' }, { model: 'deepseek-v4' }],
    });
    expect(batch.body).not.toContain('sk-secret');

    const updated = await app.inject({
      method: 'POST',
      url: `/v1/models/${sourceId}/update`,
      payload: { requestId: 'update-model', name: 'DeepSeek production', model: 'deepseek-v4' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      model: { name: 'DeepSeek production', model: 'deepseek-v4' },
    });
    expect(updated.body).not.toContain('sk-secret');
  });

  it('keeps a model that is referenced by a conversation', async () => {
    const { app, database } = createContext(undefined);
    const created = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: {
        requestId: 'create-protected-model',
        name: 'Protected',
        baseUrl: 'https://protected.example/anthropic',
        apiKey: 'sk-secret',
        model: 'protected-model',
      },
    });
    const modelId = (created.json() as { model: { id: string } }).model.id;
    database.projects.upsert({
      id: 'project-for-protected-model',
      displayName: 'Project',
      rootPath: 'D:\\Projects\\protected-model',
      createdAt: '2026-08-13T08:00:00.000Z',
    });
    database.sessions.create({
      id: 'session-for-protected-model',
      claudeSessionId: null,
      projectId: 'project-for-protected-model',
      modelId,
      title: 'Uses a model',
      status: 'idle',
      createdAt: '2026-08-13T08:00:00.000Z',
      updatedAt: '2026-08-13T08:00:00.000Z',
      archivedAt: null,
    });

    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/models/${modelId}/delete`,
      payload: { requestId: 'delete-protected-model' },
    });
    expect(deleted.statusCode).toBe(409);
    expect(deleted.json()).toMatchObject({ error: { code: 'MODEL_IN_USE' } });
  });

  it('rejects an invalid create request', async () => {
    const { app } = createContext(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: { requestId: 'bad', name: '', baseUrl: 'not-a-url', apiKey: '', model: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('stores model capabilities and enforces a capable default multimodal model', async () => {
    const { app } = createContext(undefined);
    const vision = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: {
        requestId: 'create-vision',
        name: 'Vision',
        baseUrl: 'https://vision.example.com',
        apiKey: 'vision-key',
        model: 'vision-model',
        supportsImages: true,
        supportsDocuments: true,
      },
    });
    const visionId = (vision.json() as { model: { id: string } }).model.id;
    expect(vision.json()).toMatchObject({
      model: { supportsImages: true, supportsDocuments: true, isMultimodalDefault: false },
    });

    const selected = await app.inject({
      method: 'POST',
      url: `/v1/models/${visionId}/multimodal-default`,
      payload: { requestId: 'default-vision' },
    });
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({ model: { id: visionId, isMultimodalDefault: true } });

    const disabled = await app.inject({
      method: 'POST',
      url: `/v1/models/${visionId}/update`,
      payload: { requestId: 'disable-vision', supportsImages: false },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toMatchObject({
      model: { supportsImages: false, isMultimodalDefault: false },
    });
    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/models/${visionId}/multimodal-default`,
      payload: { requestId: 'default-text-only' },
    });
    expect(rejected.statusCode).toBe(409);
  });
});
