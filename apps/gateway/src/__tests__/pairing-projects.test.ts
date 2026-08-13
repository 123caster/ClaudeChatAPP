import {
  closeDatabase,
  createDatabase,
  type DatabaseClient,
  type DeviceRepository,
} from '@claude-chat/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { DeviceAuthService, hashDeviceToken } from '../auth/device-auth-service.js';
import { PairingCodeService } from '../auth/pairing-code-service.js';
import { ProjectRegistry } from '../projects/project-registry.js';

type TestContext = {
  app: FastifyInstance;
  database: DatabaseClient;
  devices: DeviceRepository;
};
const contexts: TestContext[] = [];

function createContext(): TestContext {
  const database = createDatabase(':memory:');
  const devices = database.devices;
  const projectRepository = database.projects;
  projectRepository.upsert({
    id: 'project-1',
    displayName: 'Test project',
    rootPath: 'D:\\Projects\\test',
    createdAt: '2026-08-13T08:00:00.000Z',
  });
  const projects = new ProjectRegistry(projectRepository);
  const deviceAuth = new DeviceAuthService(
    devices,
    () => new Date('2026-08-13T08:00:00.000Z'),
    () => 'test-device-token-abcdefghijklmnopqrstuvwxyz',
  );
  const pairingCodes = new PairingCodeService({
    expiresInSeconds: 300,
    maxFailures: 5,
    failureWindowSeconds: 300,
    now: () => 1_000,
    generateCode: () => '123456',
  });
  pairingCodes.issue();
  const app = buildApp({ services: { deviceAuth, pairingCodes, projects } });

  const context = { app, database, devices };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.app.close();
    closeDatabase(context.database);
  }
});

describe('pairing and project access', () => {
  it('exchanges a one-time code and protects the project list', async () => {
    const { app, devices } = createContext();

    const unauthenticated = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(unauthenticated.statusCode).toBe(401);

    const paired = await app.inject({
      method: 'POST',
      url: '/v1/pairing/exchange',
      payload: { code: '123456', deviceName: 'Pixel 9' },
    });
    expect(paired.statusCode).toBe(201);
    expect(paired.json()).toMatchObject({
      device: { name: 'Pixel 9' },
      token: 'test-device-token-abcdefghijklmnopqrstuvwxyz',
      tokenType: 'Bearer',
    });

    const healthAfterPairing = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(healthAfterPairing.json()).toMatchObject({ pairing: { available: false } });

    const token = 'test-device-token-abcdefghijklmnopqrstuvwxyz';
    expect(devices.findActiveByTokenHash(hashDeviceToken(token))).not.toBeNull();
    expect(devices.findActiveByTokenHash(token)).toBeNull();

    const authorized = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: 'Bearer test-device-token-abcdefghijklmnopqrstuvwxyz' },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual({
      projects: [
        {
          id: 'project-1',
          displayName: 'Test project',
          rootPath: 'D:\\Projects\\test',
        },
      ],
    });

    const reused = await app.inject({
      method: 'POST',
      url: '/v1/pairing/exchange',
      payload: { code: '123456', deviceName: 'Second phone' },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ error: { code: 'DEVICE_ALREADY_PAIRED' } });
  });

  it('rejects invalid pairing codes, malformed requests and revoked tokens', async () => {
    const { app, devices } = createContext();

    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/pairing/exchange',
      payload: { code: '12345', deviceName: '' },
    });
    expect(malformed.statusCode).toBe(400);

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/pairing/exchange',
      payload: { code: '654321', deviceName: 'Pixel' },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toMatchObject({ error: { code: 'PAIRING_CODE_INVALID' } });

    const paired = await app.inject({
      method: 'POST',
      url: '/v1/pairing/exchange',
      payload: { code: '123456', deviceName: 'Pixel' },
    });
    const token = (paired.json() as { token: string }).token;
    const device = devices.findActiveByTokenHash(hashDeviceToken(token));
    expect(device).not.toBeNull();
    devices.revoke(device!.id, '2026-08-13T09:00:00.000Z');

    const revoked = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revoked.statusCode).toBe(401);
  });
});
