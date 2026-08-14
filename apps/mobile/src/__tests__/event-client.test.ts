import { EventClient } from '@/api/event-client';

class FakeWebSocket {
  public onopen: (() => void) | null = null;
  public onmessage: ((message: { data: string }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onclose: (() => void) | null = null;
  public close = jest.fn(() => this.onclose?.());
}

describe('EventClient', () => {
  it('keeps the token out of the URL and passes it to the native socket factory', () => {
    const socket = new FakeWebSocket();
    const factory = jest.fn((url: string, token: string) => {
      void url;
      void token;
      return socket as unknown as WebSocket;
    });
    const client = new EventClient(
      'http://192.168.1.20:4310',
      'secret-token-value-that-is-long-enough',
      { onEvent: jest.fn(), onStateChange: jest.fn() },
      factory,
    );

    client.start(42);

    expect(factory).toHaveBeenCalledWith(
      'ws://192.168.1.20:4310/v1/events?after=42',
      'secret-token-value-that-is-long-enough',
    );
    expect(factory.mock.calls[0]?.[0]).not.toContain('secret-token');
    client.stop();
  });

  it('parses protocol events and advances the reconnect cursor', () => {
    const sockets: FakeWebSocket[] = [];
    const events = jest.fn();
    const factory = jest.fn((_url: string, _token: string) => {
      void _url;
      void _token;
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    const client = new EventClient(
      'http://192.168.1.20:4310',
      'secret-token-value-that-is-long-enough',
      { onEvent: events, onStateChange: jest.fn() },
      factory,
    );
    client.start();
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        protocolVersion: 1,
        eventId: 9,
        sessionId: null,
        requestId: null,
        type: 'connection.ready',
        emittedAt: '2026-08-13T00:00:00.000Z',
        payload: { gatewayVersion: '0.1.0', currentEventId: 9 },
      }),
    });
    client.reconnectNow();

    expect(events).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[1]?.[0]).toContain('after=9');
    client.stop();
  });

  it('closes a socket that sends malformed JSON', () => {
    const socket = new FakeWebSocket();
    const client = new EventClient(
      'http://192.168.1.20:4310',
      'secret-token-value-that-is-long-enough',
      { onEvent: jest.fn(), onStateChange: jest.fn() },
      () => socket as unknown as WebSocket,
    );
    client.start();
    socket.onmessage?.({ data: '{not-json' });
    expect(socket.close).toHaveBeenCalledWith(1008, 'Invalid event payload.');
    client.stop();
  });

  it('does not advance the reconnect cursor for transient deltas', () => {
    const sockets: FakeWebSocket[] = [];
    const factory = jest.fn((_url: string, _token: string) => {
      void _url;
      void _token;
      const socket = new FakeWebSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    });
    const client = new EventClient(
      'http://192.168.1.20:4310',
      'secret-token-value-that-is-long-enough',
      { onEvent: jest.fn(), onStateChange: jest.fn() },
      factory,
    );
    client.start(7);
    sockets[0]?.onmessage?.({
      data: JSON.stringify({
        protocolVersion: 1,
        eventId: 8,
        sessionId: '11111111-1111-4111-8111-111111111111',
        requestId: null,
        type: 'assistant.delta',
        emittedAt: '2026-08-13T00:00:00.000Z',
        payload: {
          messageId: '22222222-2222-4222-8222-222222222222',
          delta: 'hello',
          sequence: 0,
        },
      }),
    });
    client.reconnectNow();
    expect(factory.mock.calls[1]?.[0]).toContain('after=7');
    client.stop();
  });
});
