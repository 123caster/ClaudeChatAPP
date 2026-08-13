import type { EventRepository } from '@claude-chat/database';
import { eventEnvelopeSchema, PROTOCOL_VERSION, type EventEnvelope } from '@claude-chat/protocol';

import { EventStream } from './event-stream.js';

export type EventInput = {
  sessionId: string | null;
  requestId: string | null;
  type: EventEnvelope['type'];
  payload: unknown;
};

export type EventReplay =
  | { status: 'events'; events: EventEnvelope[] }
  | { status: 'cursor_expired'; currentEventId: number };

export class EventStore {
  public constructor(
    private readonly events: EventRepository,
    private readonly stream: EventStream,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public persist(input: EventInput): EventEnvelope {
    const envelope = this.append(input);
    this.publish(envelope);
    return envelope;
  }

  public append(input: EventInput): EventEnvelope {
    const emittedAt = this.now().toISOString();
    const validated = eventEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      eventId: this.events.currentId() + 1,
      sessionId: input.sessionId,
      requestId: input.requestId,
      type: input.type,
      emittedAt,
      payload: input.payload,
    });
    const record = this.events.append({
      sessionId: validated.sessionId,
      requestId: validated.requestId,
      type: validated.type,
      payloadJson: JSON.stringify(validated.payload),
      emittedAt,
    });
    return this.parseRecord(record);
  }

  public publish(event: EventEnvelope): void {
    this.stream.publish(event);
  }

  public transient(input: EventInput): EventEnvelope {
    const envelope = eventEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      eventId: this.events.currentId(),
      sessionId: input.sessionId,
      requestId: input.requestId,
      type: input.type,
      emittedAt: this.now().toISOString(),
      payload: input.payload,
    });
    this.stream.publish(envelope);
    return envelope;
  }

  public replay(after: number, limit = 1_000, through = this.events.currentId()): EventReplay {
    const minimumId = this.events.minimumId();
    if (minimumId > 0 && after < minimumId - 1) {
      return { status: 'cursor_expired', currentEventId: through };
    }
    return {
      status: 'events',
      events: this.events
        .listAfter(after, limit)
        .filter((event) => event.id <= through)
        .map((event) => this.parseRecord(event)),
    };
  }

  public currentId(): number {
    return this.events.currentId();
  }

  private parseRecord(record: {
    id: number;
    sessionId: string | null;
    requestId: string | null;
    type: string;
    payloadJson: string;
    emittedAt: string;
  }): EventEnvelope {
    return eventEnvelopeSchema.parse({
      protocolVersion: PROTOCOL_VERSION,
      eventId: record.id,
      sessionId: record.sessionId,
      requestId: record.requestId,
      type: record.type,
      emittedAt: record.emittedAt,
      payload: JSON.parse(record.payloadJson) as unknown,
    });
  }
}
