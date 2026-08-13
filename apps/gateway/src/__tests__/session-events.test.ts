import { closeDatabase, createDatabase, type DatabaseClient } from '@claude-chat/database';
import { eventEnvelopeSchema, type EventEnvelope } from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { buildApp } from '../app.js';
import { DeviceAuthService } from '../auth/device-auth-service.js';
import { PairingCodeService } from '../auth/pairing-code-service.js';
import { FakeClaudeAdapter } from '../claude/fake-claude-adapter.js';
import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { SessionService } from '../sessions/session-service.js';

type TestContext = {
  adapter: FakeClaudeAdapter;
  app: FastifyInstance;
  database: DatabaseClient;
  events: EventStore;
  projectId: string;
  projects: ProjectRegistry;
  token: string;
};

const contexts: TestContext[] = [];

function createContext(): TestContext {
  const database = createDatabase(':memory:');
  const projects = new ProjectRegistry(database.projects, () => new Date('2026-08-13T08:00:00Z'));
  const [project] = projects.synchronize([
    { displayName: 'ClaudeChatAPP', path: 'D:\\ouyang\\Projects\\ClaudeChatAPP' },
  ]);
  const deviceAuth = new DeviceAuthService(
    database.devices,
    () => new Date('2026-08-13T08:00:00Z'),
    () => 'session-test-token-abcdefghijklmnopqrstuvwxyz',
  );
  const token = deviceAuth.pair('Test Android').token;
  const pairingCodes = new PairingCodeService({
    expiresInSeconds: 300,
    maxFailures: 5,
    failureWindowSeconds: 300,
  });
  const eventStream = new EventStream();
  const events = new EventStore(database.events, eventStream);
  const adapter = new FakeClaudeAdapter();
  const sessions = new SessionService(database, projects, adapter, events);
  const app = buildApp({
    logger: process.env.DEBUG_WEBSOCKET === '1',
    gatewayVersion: 'test-version',
    services: { deviceAuth, pairingCodes, projects, events, eventStream, sessions },
  });
  const context = { adapter, app, database, events, projectId: project!.id, projects, token };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.app.close();
    closeDatabase(context.database);
  }
});

async function waitForSessionStatus(
  context: TestContext,
  sessionId: string,
  status: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await context.app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${context.token}` },
    });
    if ((response.json() as { session: { status: string } }).session.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Session ${sessionId} did not reach ${status}.`);
}

describe('session HTTP and resumable events', () => {
  it('creates, runs and idempotently replays a fake Claude session', async () => {
    const context = createContext();
    const payload = {
      requestId: 'create-session-1',
      projectId: context.projectId,
      message: 'Inspect the project',
    };
    const first = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${context.token}` },
      payload,
    });
    const second = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${context.token}` },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    const sessionId = (first.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'idle');

    const list = await context.app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${context.token}` },
    });
    expect(list.json()).toMatchObject({ sessions: [{ id: sessionId, status: 'idle' }] });

    const detail = await context.app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${context.token}` },
    });
    expect(detail.json()).toMatchObject({
      session: {
        messages: [
          { role: 'user', content: 'Inspect the project' },
          { role: 'assistant', content: 'Echo: Inspect the project' },
        ],
      },
    });
    expect(context.database.sessions.list()).toHaveLength(1);
    expect(
      context.database.events.listAfter(0, 100).filter((event) => event.type === 'session.created'),
    ).toHaveLength(1);
  });

  it('authenticates WebSocket, replays history and broadcasts live events', async () => {
    const context = createContext();
    context.events.persist({
      sessionId: null,
      requestId: null,
      type: 'server.notice',
      payload: { level: 'info', code: 'HISTORY', message: 'Historical event' },
    });
    const address = await context.app.listen({ host: '127.0.0.1', port: 0 });
    const unauthorizedSocket = new WebSocket(`${address.replace('http', 'ws')}/v1/events?after=0`);
    const unauthorizedStatus = await new Promise<number>((resolve, reject) => {
      unauthorizedSocket.once('unexpected-response', (_request, response) => {
        resolve(response.statusCode ?? 0);
        response.destroy();
      });
      unauthorizedSocket.once('error', reject);
    });
    expect(unauthorizedStatus).toBe(401);

    const messages: EventEnvelope[] = [];
    const socket = new WebSocket(`${address.replace('http', 'ws')}/v1/events?after=0`, {
      headers: { Authorization: `Bearer ${context.token}` },
    });
    socket.on('message', (data) => {
      messages.push(eventEnvelopeSchema.parse(JSON.parse(data.toString()) as unknown));
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    for (let attempt = 0; attempt < 50 && messages.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(messages.map((event) => event.type)).toEqual(['connection.ready', 'server.notice']);

    context.events.persist({
      sessionId: null,
      requestId: null,
      type: 'server.notice',
      payload: { level: 'warning', code: 'LIVE', message: 'Live event' },
    });
    for (let attempt = 0; attempt < 50 && messages.length < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(messages.at(-1)).toMatchObject({ type: 'server.notice', payload: { code: 'LIVE' } });
    socket.close();
  });

  it('pages WebSocket replay through more than one thousand retained events', async () => {
    const context = createContext();
    for (let index = 1; index <= 1_005; index += 1) {
      context.events.persist({
        sessionId: null,
        requestId: null,
        type: 'server.notice',
        payload: { level: 'info', code: `EVENT_${index}`, message: 'Replay test' },
      });
    }
    const address = await context.app.listen({ host: '127.0.0.1', port: 0 });
    const messages: EventEnvelope[] = [];
    const socket = new WebSocket(`${address.replace('http', 'ws')}/v1/events?after=0`, {
      headers: { Authorization: `Bearer ${context.token}` },
    });
    socket.on('message', (data) => {
      messages.push(eventEnvelopeSchema.parse(JSON.parse(data.toString()) as unknown));
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    for (let attempt = 0; attempt < 200 && messages.length < 1_006; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(messages).toHaveLength(1_006);
    expect(messages[1]?.eventId).toBe(1);
    expect(messages.at(-1)?.eventId).toBe(1_005);
    socket.close();
  });

  it('waits for and atomically resolves a tool permission', async () => {
    const context = createContext();
    context.adapter.enqueue([
      { type: 'tool_start', toolCallId: 'sdk-tool-1', toolName: 'Bash', input: { command: 'pwd' } },
      {
        type: 'permission',
        request: {
          toolCallId: 'sdk-tool-1',
          toolName: 'Bash',
          input: { command: 'pwd' },
          reason: 'Inspect the current directory',
        },
      },
      { type: 'tool_complete', toolCallId: 'sdk-tool-1', output: 'D:\\Projects' },
      { type: 'complete_message', text: 'Done' },
      { type: 'complete_turn' },
    ]);
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${context.token}` },
      payload: {
        requestId: 'permission-session-1',
        projectId: context.projectId,
        message: 'Run pwd',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'waiting_permission');
    const [permission] = context.database.permissions.listUnresolved();
    expect(permission).toBeDefined();

    const decided = await context.app.inject({
      method: 'POST',
      url: `/v1/permissions/${permission!.id}/decision`,
      headers: { authorization: `Bearer ${context.token}` },
      payload: { requestId: 'permission-decision-1', decision: 'allow_once' },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({
      permission: { id: permission!.id, status: 'resolved', decision: 'allow_once' },
    });
    await waitForSessionStatus(context, sessionId, 'idle');

    const duplicate = await context.app.inject({
      method: 'POST',
      url: `/v1/permissions/${permission!.id}/decision`,
      headers: { authorization: `Bearer ${context.token}` },
      payload: { requestId: 'permission-decision-1', decision: 'allow_once' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(decided.json());
  });

  it('cancels a turn while Claude is waiting for permission', async () => {
    const context = createContext();
    context.adapter.enqueue([
      {
        type: 'permission',
        request: { toolCallId: null, toolName: 'Write', input: { path: 'blocked.txt' } },
      },
      { type: 'complete_turn' },
    ]);
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${context.token}` },
      payload: {
        requestId: 'cancel-session-1',
        projectId: context.projectId,
        message: 'Write a file',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'waiting_permission');

    const cancelled = await context.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/cancel`,
      headers: { authorization: `Bearer ${context.token}` },
      payload: { requestId: 'cancel-turn-1' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ session: { status: 'interrupted' } });
    expect(context.database.permissions.listUnresolved()).toEqual([]);
  });

  it('resumes an interrupted idempotent create without duplicating the user message', async () => {
    const context = createContext();
    context.adapter.enqueue([
      {
        type: 'permission',
        request: { toolCallId: null, toolName: 'Read', input: { path: 'README.md' } },
      },
    ]);
    const request = {
      requestId: 'recover-idempotent-create-1',
      projectId: context.projectId,
      message: 'Read the README',
    };
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { authorization: `Bearer ${context.token}` },
      payload: request,
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'waiting_permission');
    context.database.sessions.updateStatus(sessionId, 'interrupted', '2026-08-13T08:01:00.000Z');

    const restarted = new SessionService(
      context.database,
      context.projects,
      new FakeClaudeAdapter(),
      context.events,
    );
    restarted.recoverOnStartup();
    expect(restarted.create(request).session.status).toBe('running');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (context.database.sessions.get(sessionId)?.status === 'idle') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(context.database.sessions.get(sessionId)?.status).toBe('idle');
    expect(context.database.sessions.list()).toHaveLength(1);
    expect(
      context.database.messages.listBySession(sessionId).map((message) => message.role),
    ).toEqual(['user', 'assistant']);
  });
});
