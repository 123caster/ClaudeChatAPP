import { closeDatabase, createDatabase } from '@claude-chat/database';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { DeviceAuthService } from '../auth/device-auth-service.js';
import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { ExpoPushClient } from '../push/expo-push-client.js';
import { PushService } from '../push/push-service.js';
import { ScheduledRunService } from '../scheduled/scheduled-run-service.js';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('push subscription routes', () => {
  it('binds a token to the authenticated device and never returns the token', async () => {
    const database = createDatabase(':memory:');
    const deviceAuth = new DeviceAuthService(
      database.devices,
      undefined,
      () => 'device-secret-token-123456',
    );
    const paired = deviceAuth.pair('Phone');
    const events = new EventStore(database.events, new EventStream());
    const runs = new ScheduledRunService(database, events);
    const push = new PushService(database, runs, false, new ExpoPushClient());
    const projects = new ProjectRegistry(database.projects);
    const app = buildApp({ services: { projects, deviceAuth, push } });
    cleanups.push(async () => {
      await app.close();
      closeDatabase(database);
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/push-subscriptions',
      headers: { authorization: `Bearer ${paired.token}` },
      payload: {
        requestId: 'push-1',
        provider: 'expo',
        platform: 'android',
        token: 'ExponentPushToken[device-token]',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      subscription: { deviceId: paired.device.id, provider: 'expo', enabled: true },
    });
    expect(response.body).not.toContain('device-token');
    expect(database.pushSubscriptions.getByDevice(paired.device.id)?.token).toContain(
      'device-token',
    );
  });
});
