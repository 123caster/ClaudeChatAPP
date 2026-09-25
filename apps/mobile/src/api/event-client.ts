import { eventEnvelopeSchema, type EventEnvelope } from '@claude-chat/protocol';

type EventClientCallbacks = {
  onEvent: (event: EventEnvelope) => void;
  onStateChange: (state: 'connecting' | 'open' | 'closed') => void;
};

type WebSocketFactory = (url: string, deviceToken: string) => WebSocket;

type NativeWebSocketOptions = {
  headers: Record<string, string>;
};

type NativeWebSocketConstructor = new (
  url: string,
  protocols?: string[],
  options?: NativeWebSocketOptions,
) => WebSocket;

export class EventClient {
  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private retryAttempt = 0;
  private after = 0;

  public constructor(
    private readonly gatewayUrl: string,
    private readonly deviceToken: string,
    private readonly callbacks: EventClientCallbacks,
    private readonly webSocketFactory: WebSocketFactory = createNativeWebSocket,
  ) {}

  public start(after = this.after): void {
    this.after = Math.max(this.after, after);
    this.stopped = false;
    this.open();
  }

  public reconnectNow(): void {
    if (this.stopped) return;
    this.clearRetry();
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.open();
  }

  public stop(): void {
    this.stopped = true;
    this.clearRetry();
    this.socket?.close();
    this.socket = null;
  }

  private open(): void {
    if (this.stopped || this.socket) return;
    this.callbacks.onStateChange('connecting');
    const wsUrl = new URL('/v1/events', this.gatewayUrl);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.searchParams.set('after', String(this.after));
    const socket = this.webSocketFactory(wsUrl.toString(), this.deviceToken);
    this.socket = socket;

    socket.onopen = () => {
      this.retryAttempt = 0;
      this.callbacks.onStateChange('open');
    };
    socket.onmessage = (message) => {
      if (typeof message.data !== 'string') return;
      let payload: unknown;
      try {
        payload = JSON.parse(message.data) as unknown;
      } catch {
        socket.close(1008, 'Invalid event payload.');
        return;
      }
      const parsed = eventEnvelopeSchema.safeParse(payload);
      if (!parsed.success) return;
      if (parsed.data.type !== 'assistant.delta' && parsed.data.eventId > this.after) {
        this.after = parsed.data.eventId;
      }
      this.callbacks.onEvent(parsed.data);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.callbacks.onStateChange('closed');
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.retryAttempt++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}

function createNativeWebSocket(url: string, deviceToken: string): WebSocket {
  const Socket = WebSocket as unknown as NativeWebSocketConstructor;
  return new Socket(url, [], { headers: { Authorization: `Bearer ${deviceToken}` } });
}
