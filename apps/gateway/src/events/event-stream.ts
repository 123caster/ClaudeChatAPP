import type { EventEnvelope } from '@claude-chat/protocol';

export type EventListener = (event: EventEnvelope) => void;

export class EventStream {
  private readonly listeners = new Set<EventListener>();

  public constructor(
    private readonly onListenerError: (error: unknown) => void = () => undefined,
  ) {}

  public publish(event: EventEnvelope): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }

  public subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
