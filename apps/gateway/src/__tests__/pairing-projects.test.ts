import { closeDatabase, createDatabase, type DatabaseClient } from '@claude-chat/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { DeviceAuthService } from '../auth/device-auth-service.js';
import { PairingCodeService } from '../auth/pairing-code-service.js';
import { ProjectRegistry } from '../projects/project-registry.js';

type TestContext = {
  app: FastifyInstance;
  database: DatabaseClient;
};
const contexts: TestContext[] = [];

function createContext(apiKey?: string): TestContext {
  const database = createDatabase(':memory:');
  const projectRepository = database.projects;
  projectRepository.upsert({
    id: 'project-1',
    displayName: 'Test project',
    rootPath: 'D:\\Projects\\test',
    createdAt: '2026-08-13T08:00:00.000Z',
  });
  const projects = new ProjectRegistry(projectRepository);
  const app = buildApp({ apiKey, services: { projects } });

  const context = { app, database };
  contexts.push(context);
  return context;
}

function createPairingContext(): TestContext {
  const database = createDatabase(':memory:');
  database.projects.upsert({
    id: 'project-1',
    displayName: 'Test project',
    rootPath: 'D:\\Projects\\test',
    createdAt: '2026-08-13T08:00:00.000Z',
  });
  const projects = new ProjectRegistry(database.projects);
  const deviceAuth = new DeviceAuthService(
    database.devices,
    () => new Date('2026-08-28T08:00:00.000Z'),
    () => 'fixed_device_token_abcdefghijklmnopqrstuvwxyz012345',
  );
  const pairingCodes = new PairingCodeService({
    expiresInSeconds: 300,
    maxFailures: 5,
    failureWindowSeconds: 300,
    now: () => Date.parse('2026-08-28T08:00:00.000Z'),
    generateCode: () => '123456',
  });
  pairingCodes.issue();
  const app = buildApp({ services: { projects, deviceAuth, pairingCodes } });
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

describe('project access', () => {
  it('protects the project list with the API key', async () => {
    const { app } = createContext('top-secret-key');

    const unauthenticated = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(unauthenticated.statusCode).toBe(401);

    const authorized = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { 'x-api-key': 'top-secret-key' },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual({
      projects: [
        {
          id: 'project-1',
          displayName: 'Test project',
          rootPath: 'D:\\Projects\\test',
          origin: 'config',
        },
      ],
    });
  });

  it('exposes the project list when no API key is configured', async () => {
    const { app } = createContext(undefined);
    const response = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      projects: [
        {
          id: 'project-1',
          displayName: 'Test project',
          rootPath: 'D:\\Projects\\test',
          origin: 'config',
        },
      ],
    });
  });

  it('exchanges a one-time code and authorizes the paired device token', async () => {
    const { app } = createPairingContext();

    const beforePairing = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(beforePairing.statusCode).toBe(401);

    const paired = await app.inject({
      method: 'POST',
      url: '/v1/pairing/exchange',
      payload: { code: '123456', deviceName: 'Ouyang phone' },
    });
    expect(paired.statusCode).toBe(201);
    expect(paired.json()).toMatchObject({
      token: 'fixed_device_token_abcdefghijklmnopqrstuvwxyz012345',
      tokenType: 'Bearer',
      device: { name: 'Ouyang phone' },
    });

    const authorized = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: {
        authorization: `Bearer ${paired.json<{ token: string }>().token}`,
      },
    });
    expect(authorized.statusCode).toBe(200);

    const reused = await app.inject({
      method: 'POST',
      url: '/v1/pairing/exchange',
      payload: { code: '123456', deviceName: 'Second phone' },
    });
    expect(reused.statusCode).toBe(409);
  });
});
