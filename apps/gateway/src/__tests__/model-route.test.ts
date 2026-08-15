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
  const models = new ModelService(database.models, () => new Date('2026-08-13T08:00:00Z'));
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

  it('rejects an invalid create request', async () => {
    const { app } = createContext(undefined);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/models',
      payload: { requestId: 'bad', name: '', baseUrl: 'not-a-url', apiKey: '', model: '' },
    });
    expect(response.statusCode).toBe(400);
  });
});
