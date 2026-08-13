import type { EventRepository } from '@claude-chat/database';
import { describe, expect, it } from 'vitest';

import { EventStore } from '../events/event-store.js';
import { EventStream } from '../events/event-stream.js';

describe('EventStore replay', () => {
  it('validates an event before appending it to SQLite', () => {
    let appendCount = 0;
    const repository: EventRepository = {
      append: (event) => {
        appendCount += 1;
        return { ...event, id: 1 };
      },
      listAfter: () => [],
      currentId: () => 0,
      minimumId: () => 0,
    };
    const store = new EventStore(repository, new EventStream());

    expect(() =>
      store.persist({
        sessionId: null,
        requestId: null,
        type: 'server.notice',
        payload: { level: 'invalid', code: 'BAD', message: 'bad' },
      }),
    ).toThrow();
    expect(appendCount).toBe(0);
  });

  it('isolates a failed realtime subscriber from other listeners', () => {
    const errors: unknown[] = [];
    const stream = new EventStream((error) => errors.push(error));
    const received: string[] = [];
    stream.subscribe(() => {
      throw new Error('socket closed');
    });
    stream.subscribe((event) => received.push(event.type));

    stream.publish({
      protocolVersion: 1,
      eventId: 1,
      sessionId: null,
      requestId: null,
      type: 'server.notice',
      emittedAt: '2026-08-13T08:00:00.000Z',
      payload: { level: 'info', code: 'TEST', message: 'test' },
    });

    expect(errors).toHaveLength(1);
    expect(received).toEqual(['server.notice']);
  });

  it('requests a snapshot when the client cursor predates retained events', () => {
    const repository: EventRepository = {
      append: () => {
        throw new Error('not used');
      },
      listAfter: () => [],
      currentId: () => 12,
      minimumId: () => 5,
    };
    const store = new EventStore(repository, new EventStream());

    expect(store.replay(3)).toEqual({ status: 'cursor_expired', currentEventId: 12 });
    expect(store.replay(4)).toEqual({ status: 'events', events: [] });
  });

  it('does not replay events beyond the captured high watermark', () => {
    const records = [5, 6].map((id) => ({
      id,
      sessionId: null,
      requestId: null,
      type: 'server.notice',
      payloadJson: JSON.stringify({ level: 'info', code: `EVENT_${id}`, message: 'test' }),
      emittedAt: '2026-08-13T08:00:00.000Z',
    }));
    const repository: EventRepository = {
      append: () => {
        throw new Error('not used');
      },
      listAfter: () => records,
      currentId: () => 6,
      minimumId: () => 1,
    };
    const store = new EventStore(repository, new EventStream());

    const replay = store.replay(4, 100, 5);
    expect(replay.status).toBe('events');
    if (replay.status === 'events') {
      expect(replay.events.map((event) => event.eventId)).toEqual([5]);
    }
  });
});
