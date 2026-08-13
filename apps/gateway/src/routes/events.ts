import websocket from '@fastify/websocket';
import { PROTOCOL_VERSION, eventEnvelopeSchema, type EventEnvelope } from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createAuthenticationHook } from '../auth/authenticate.js';
import type { DeviceAuthService } from '../auth/device-auth-service.js';
import type { EventStore } from '../events/event-store.js';
import type { EventStream } from '../events/event-stream.js';
import { GATEWAY_VERSION } from '../version.js';
import type { SessionService } from '../sessions/session-service.js';

const eventQuerySchema = z
  .object({ after: z.coerce.number().int().nonnegative().default(0) })
  .strict();

type EventRouteOptions = {
  deviceAuth: DeviceAuthService;
  events: EventStore;
  eventStream: EventStream;
  sessions: SessionService;
  gatewayVersion?: string;
};

export function registerEventRoute(app: FastifyInstance, options: EventRouteOptions): void {
  void app.register(async (eventApp) => {
    await eventApp.register(websocket);
    eventApp.get(
      '/v1/events',
      {
        websocket: true,
        preValidation: createAuthenticationHook(options.deviceAuth),
      },
      (socket, request) => {
        const query = eventQuerySchema.safeParse(request.query);
        if (!query.success) {
          socket.close(1008, 'Invalid event cursor.');
          return;
        }

        const send = (event: unknown) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify(eventEnvelopeSchema.parse(event)));
          }
        };
        const highWatermark = options.events.currentId();
        const buffered: EventEnvelope[] = [];
        let catchingUp = true;
        const unsubscribe = options.eventStream.subscribe((event) => {
          if (catchingUp) {
            buffered.push(event);
          } else {
            send(event);
          }
        });
        socket.once('close', unsubscribe);
        socket.once('error', unsubscribe);

        send({
          protocolVersion: PROTOCOL_VERSION,
          eventId: highWatermark,
          sessionId: null,
          requestId: null,
          type: 'connection.ready',
          emittedAt: new Date().toISOString(),
          payload: {
            gatewayVersion: options.gatewayVersion ?? GATEWAY_VERSION,
            currentEventId: highWatermark,
          },
        });

        let cursor = query.data.after;
        let replay = options.events.replay(cursor, 1_000, highWatermark);
        if (replay.status === 'cursor_expired') {
          send({
            protocolVersion: PROTOCOL_VERSION,
            eventId: replay.currentEventId,
            sessionId: null,
            requestId: null,
            type: 'session.snapshot',
            emittedAt: new Date().toISOString(),
            payload: {
              currentEventId: replay.currentEventId,
              sessions: options.sessions
                .list()
                .map((session) => options.sessions.detail(session.id)),
            },
          });
        } else {
          while (replay.status === 'events') {
            replay.events.forEach(send);
            const lastEvent = replay.events.at(-1);
            if (!lastEvent || replay.events.length < 1_000 || lastEvent.eventId >= highWatermark) {
              break;
            }
            cursor = lastEvent.eventId;
            replay = options.events.replay(cursor, 1_000, highWatermark);
          }
        }

        catchingUp = false;
        for (const event of buffered) {
          if (event.type === 'assistant.delta' || event.eventId > highWatermark) {
            send(event);
          }
        }
      },
    );
  });
}
