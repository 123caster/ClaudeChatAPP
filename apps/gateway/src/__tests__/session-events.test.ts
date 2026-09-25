import { closeDatabase, createDatabase, type DatabaseClient } from '@claude-chat/database';
import { eventEnvelopeSchema, type EventEnvelope } from '@claude-chat/protocol';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { buildApp } from '../app.js';
import { FakeClaudeAdapter } from '../claude/fake-claude-adapter.js';
import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';
import { ModelService } from '../models/model-service.js';
import { ProjectRegistry } from '../projects/project-registry.js';
import { SessionService } from '../sessions/session-service.js';

const API_KEY = 'top-secret-key';

type TestContext = {
  adapter: FakeClaudeAdapter;
  app: FastifyInstance;
  database: DatabaseClient;
  events: EventStore;
  models: ModelService;
  projectId: string;
  projects: ProjectRegistry;
};

const contexts: TestContext[] = [];
const tempRoots: string[] = [];

function createContext(): TestContext {
  const database = createDatabase(':memory:');
  const projectRoot = mkdtempSync(join(tmpdir(), 'claude-chat-session-'));
  tempRoots.push(projectRoot);
  const projects = new ProjectRegistry(database.projects, () => new Date('2026-08-13T08:00:00Z'));
  const [project] = projects.synchronize([{ displayName: 'ClaudeChatAPP', path: projectRoot }]);
  const eventStream = new EventStream();
  const events = new EventStore(database.events, eventStream);
  const models = new ModelService(database.models, () => new Date('2026-08-13T08:00:00Z'));
  const adapter = new FakeClaudeAdapter();
  const sessions = new SessionService(database, projects, adapter, events, undefined, models);
  const app = buildApp({
    logger: process.env.DEBUG_WEBSOCKET === '1',
    gatewayVersion: 'test-version',
    apiKey: API_KEY,
    services: { projects, models, events, eventStream, sessions },
  });
  const context = { adapter, app, database, events, models, projectId: project!.id, projects };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.app.close();
    closeDatabase(context.database);
  }
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
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
      headers: { 'x-api-key': API_KEY },
    });
    if ((response.json() as { session: { status: string } }).session.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Session ${sessionId} did not reach ${status}.`);
}

async function openEventSocket(
  context: TestContext,
  address: string,
  after = 0,
): Promise<{ messages: EventEnvelope[]; socket: WebSocket }> {
  const messages: EventEnvelope[] = [];
  const socket = new WebSocket(`${address.replace('http', 'ws')}/v1/events?after=${after}`, {
    headers: { 'x-api-key': API_KEY },
  });
  socket.on('message', (data) => {
    messages.push(eventEnvelopeSchema.parse(JSON.parse(data.toString()) as unknown));
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return { messages, socket };
}

async function waitForEvent(
  messages: EventEnvelope[],
  predicate: (event: EventEnvelope) => boolean,
): Promise<EventEnvelope> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const event = messages.find(predicate);
    if (event) return event;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Expected WebSocket event was not received.');
}

describe('session HTTP and resumable events', () => {
  it('uses and persists an existing project subdirectory for every turn', async () => {
    const context = createContext();
    const projectRoot = context.projects
      .list()
      .find(({ id }) => id === context.projectId)!.rootPath;
    const childDirectory = join(projectRoot, 'myclaude', 'apps', 'mobile');
    mkdirSync(childDirectory, { recursive: true });

    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'workdir-create-1',
        projectId: context.projectId,
        workingDirectory: 'myclaude/apps/mobile',
        message: 'Inspect this directory',
      },
    });
    expect(created.statusCode).toBe(201);
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'idle');
    expect(context.database.sessions.get(sessionId)).toMatchObject({
      workingDirectory: 'myclaude/apps/mobile',
    });
    expect(context.adapter.requests[0]?.cwd).toBe(childDirectory);

    const continued = await context.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/messages`,
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'workdir-message-1', message: 'Continue here' },
    });
    expect(continued.statusCode).toBe(200);
    await waitForSessionStatus(context, sessionId, 'idle');
    expect(context.adapter.requests[1]?.cwd).toBe(childDirectory);
  });

  it('rejects a working directory that escapes the project root', async () => {
    const context = createContext();
    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'workdir-invalid-1',
        projectId: context.projectId,
        workingDirectory: '../outside',
        message: 'Must not run',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(context.adapter.requests).toHaveLength(0);
  });

  it.each([
    [['delta', 'Context was compacted.'], '上下文压缩成功\n\nContext was compacted.'],
    [['empty', ''], '上下文压缩成功'],
  ] as const)('persists a readable compact %s result', async ([kind, output], expected) => {
    const context = createContext();
    context.adapter.enqueue(
      kind === 'delta'
        ? [{ type: 'delta', text: output }, { type: 'complete_turn' }]
        : [{ type: 'complete_turn' }],
    );
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: `compact-${kind}-1`,
        projectId: context.projectId,
        message: '/compact',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'idle');
    expect(context.database.messages.listBySession(sessionId).at(-1)?.contentJson).toBe(
      JSON.stringify({ text: expected }),
    );
  });

  it('persists a sanitized compact failure result', async () => {
    const context = createContext();
    context.adapter.enqueue([
      { type: 'fail', message: 'apiKey=secret-value failed at /home/ubuntu/private/config.json' },
    ]);
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'compact-failure-1',
        projectId: context.projectId,
        message: '/compact',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'interrupted');
    const content = context.database.messages.listBySession(sessionId).at(-1)?.contentJson ?? '';
    expect(content).toContain('上下文压缩失败');
    expect(content).toContain('[REDACTED]');
    expect(content).toContain('[PATH]');
    expect(content).not.toContain('secret-value');
    expect(content).not.toContain('/home/ubuntu/private');
  });

  it('renames a session once and publishes the updated summary', async () => {
    const context = createContext();
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'rename-create-1',
        projectId: context.projectId,
        message: 'Original title',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;

    const renamed = await context.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/rename`,
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'rename-session-1', title: 'A clearer title' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      requestId: 'rename-session-1',
      session: { id: sessionId, title: 'A clearer title' },
    });
    expect(context.database.sessions.get(sessionId)).toMatchObject({ title: 'A clearer title' });
    expect(context.database.events.listAfter(0, 100)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requestId: 'rename-session-1', type: 'session.updated' }),
      ]),
    );

    const replayed = await context.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/rename`,
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'rename-session-1', title: 'A clearer title' },
    });
    expect(replayed.statusCode).toBe(200);
    expect(
      context.database.events
        .listAfter(0, 100)
        .filter((event) => event.requestId === 'rename-session-1'),
    ).toHaveLength(1);
  });

  it('clears an interrupted session without retaining its messages or event replay history', async () => {
    const context = createContext();
    context.adapter.enqueue([
      {
        type: 'permission',
        request: { toolCallId: null, toolName: 'Write', input: { path: 'blocked.txt' } },
      },
    ]);
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'clear-create-1',
        projectId: context.projectId,
        message: 'Write a file',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'waiting_permission');

    const cleared = await context.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/clear`,
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'clear-session-1' },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({
      requestId: 'clear-session-1',
      session: { id: sessionId, status: 'idle', messages: [], toolCalls: [], permissions: [] },
    });
    expect(context.database.sessions.get(sessionId)).toMatchObject({
      claudeSessionId: null,
      status: 'idle',
    });
    expect(context.database.messages.listBySession(sessionId)).toEqual([]);
    expect(context.database.toolCalls.listBySession(sessionId)).toEqual([]);
    expect(context.database.permissions.listBySession(sessionId)).toEqual([]);
    expect(
      context.database.events.listAfter(0, 100).filter((event) => event.sessionId === sessionId),
    ).toMatchObject([{ requestId: 'clear-session-1', type: 'session.updated' }]);

    const replayed = await context.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/clear`,
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'clear-session-1' },
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toEqual(cleared.json());
  });

  it('switches the model for one idle session without changing the Gateway default', async () => {
    const context = createContext();
    const firstModel = context.models.create({
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      apiKey: 'model-key-a',
      model: 'deepseek-chat',
    });
    const secondModel = context.models.createVariant(firstModel.id, 'deepseek-reasoner');
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'session-with-model',
        projectId: context.projectId,
        message: 'Use the default model first',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'idle');

    const switched = await context.app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/model`,
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'switch-session-model', modelId: secondModel.id },
    });
    expect(switched.statusCode).toBe(200);
    expect(context.database.sessions.get(sessionId)).toMatchObject({ modelId: secondModel.id });
    expect(context.models.getActiveModelId()).toBe(firstModel.id);
  });

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
      headers: { 'x-api-key': API_KEY },
      payload,
    });
    const second = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const sessionId = (first.json() as { session: { id: string } }).session.id;
    expect(second.json()).toMatchObject({
      requestId: payload.requestId,
      session: { id: sessionId },
    });
    await waitForSessionStatus(context, sessionId, 'idle');

    const list = await context.app.inject({
      method: 'GET',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
    });
    expect(list.json()).toMatchObject({ sessions: [{ id: sessionId, status: 'idle' }] });

    const detail = await context.app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}`,
      headers: { 'x-api-key': API_KEY },
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
        unauthorizedSocket.terminate();
      });
      unauthorizedSocket.once('error', reject);
    });
    expect(unauthorizedStatus).toBe(401);

    const messages: EventEnvelope[] = [];
    const socket = new WebSocket(`${address.replace('http', 'ws')}/v1/events?after=0`, {
      headers: { 'x-api-key': API_KEY },
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

  it('streams multiple deltas and persists one final assistant message', async () => {
    const context = createContext();
    context.adapter.enqueue([
      { type: 'delta', text: 'Hello' },
      { type: 'delta', text: ' mobile' },
      { type: 'complete_message', text: 'Hello mobile' },
      { type: 'complete_turn' },
    ]);
    const address = await context.app.listen({ host: '127.0.0.1', port: 0 });
    const { messages, socket } = await openEventSocket(context, address);

    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'stream-session-1',
        projectId: context.projectId,
        message: 'Stream a greeting',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'idle');
    await waitForEvent(
      messages,
      (event) => event.sessionId === sessionId && event.type === 'turn.completed',
    );

    const sessionEvents = messages.filter((event) => event.sessionId === sessionId);
    expect(
      sessionEvents
        .filter((event) => event.type === 'assistant.delta')
        .map((event) => (event.type === 'assistant.delta' ? event.payload.delta : '')),
    ).toEqual(['Hello', ' mobile']);
    expect(sessionEvents.map((event) => event.type)).toEqual([
      'session.created',
      'message.created',
      'assistant.delta',
      'assistant.delta',
      'message.created',
      'turn.completed',
    ]);

    const detail = await context.app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}`,
      headers: { 'x-api-key': API_KEY },
    });
    expect(detail.json()).toMatchObject({
      session: {
        messages: [
          { role: 'user', content: 'Stream a greeting', isPartial: false },
          { role: 'assistant', content: 'Hello mobile', isPartial: false },
        ],
      },
    });
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
      headers: { 'x-api-key': API_KEY },
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
      headers: { 'x-api-key': API_KEY },
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
      headers: { 'x-api-key': API_KEY },
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
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'permission-decision-1', decision: 'allow_once' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual(decided.json());
  });

  it('denies a tool permission and fails the turn without completing the tool', async () => {
    const context = createContext();
    context.adapter.enqueue([
      {
        type: 'tool_start',
        toolCallId: 'sdk-tool-deny-1',
        toolName: 'Write',
        input: { path: 'blocked.txt' },
      },
      {
        type: 'permission',
        request: {
          toolCallId: 'sdk-tool-deny-1',
          toolName: 'Write',
          input: { path: 'blocked.txt' },
          reason: 'Modify a file',
        },
      },
      { type: 'tool_complete', toolCallId: 'sdk-tool-deny-1', output: 'must not run' },
      { type: 'complete_turn' },
    ]);
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'deny-session-1',
        projectId: context.projectId,
        message: 'Write a file',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'waiting_permission');
    const [permission] = context.database.permissions.listUnresolved();

    const denied = await context.app.inject({
      method: 'POST',
      url: `/v1/permissions/${permission!.id}/decision`,
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'deny-permission-1', decision: 'deny' },
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toMatchObject({
      permission: { status: 'resolved', decision: 'deny' },
    });
    await waitForSessionStatus(context, sessionId, 'interrupted');

    const eventTypes = context.database.events
      .listAfter(0, 100)
      .filter((event) => event.sessionId === sessionId)
      .map((event) => event.type);
    expect(eventTypes).toContain('permission.resolved');
    expect(eventTypes).toContain('turn.failed');
    expect(eventTypes).not.toContain('tool.completed');
    expect(eventTypes).not.toContain('turn.completed');
  });

  it('reconnects after the last durable event without replaying transient deltas', async () => {
    const context = createContext();
    const address = await context.app.listen({ host: '127.0.0.1', port: 0 });
    context.events.persist({
      sessionId: null,
      requestId: null,
      type: 'server.notice',
      payload: { level: 'info', code: 'BEFORE', message: 'Before disconnect' },
    });
    const first = await openEventSocket(context, address);
    const before = await waitForEvent(
      first.messages,
      (event) => event.type === 'server.notice' && event.payload.code === 'BEFORE',
    );
    first.socket.close();
    await new Promise<void>((resolve) => first.socket.once('close', () => resolve()));

    context.events.transient({
      sessionId: null,
      requestId: null,
      type: 'server.notice',
      payload: { level: 'info', code: 'TRANSIENT', message: 'Do not replay' },
    });
    context.events.persist({
      sessionId: null,
      requestId: null,
      type: 'server.notice',
      payload: { level: 'info', code: 'AFTER', message: 'After disconnect' },
    });

    const second = await openEventSocket(context, address, before.eventId);
    await waitForEvent(
      second.messages,
      (event) => event.type === 'server.notice' && event.payload.code === 'AFTER',
    );
    const notices = second.messages
      .filter((event) => event.type === 'server.notice')
      .map((event) => (event.type === 'server.notice' ? event.payload.code : ''));
    expect(notices).toEqual(['AFTER']);
    expect(
      second.messages
        .filter((event) => event.type !== 'connection.ready' && event.eventId > 0)
        .map((event) => event.eventId),
    ).toEqual([before.eventId + 1]);
    second.socket.close();
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
      headers: { 'x-api-key': API_KEY },
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
      headers: { 'x-api-key': API_KEY },
      payload: { requestId: 'cancel-turn-1' },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ session: { status: 'interrupted' } });
    expect(context.database.permissions.listUnresolved()).toEqual([]);

    const replayed = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'cancel-session-1',
        projectId: context.projectId,
        message: 'Write a file',
      },
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.json()).toMatchObject({ session: { status: 'interrupted' } });
  });

  it('persists the Claude session ID before a turn finishes', async () => {
    const context = createContext();
    context.adapter.enqueue([
      { type: 'session_start', claudeSessionId: 'claude-early-1' },
      {
        type: 'permission',
        request: { toolCallId: 'tool-1', toolName: 'Write', input: { path: 'blocked.txt' } },
      },
    ]);
    const created = await context.app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: { 'x-api-key': API_KEY },
      payload: {
        requestId: 'early-session-id-1',
        projectId: context.projectId,
        message: 'Write a file',
      },
    });
    const sessionId = (created.json() as { session: { id: string } }).session.id;
    await waitForSessionStatus(context, sessionId, 'waiting_permission');
    expect(context.database.sessions.get(sessionId)?.claudeSessionId).toBe('claude-early-1');
    expect(context.database.permissions.listUnresolved()[0]?.toolCallId).toBeTruthy();
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
      headers: { 'x-api-key': API_KEY },
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
