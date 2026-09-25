import { GatewayClient, createEntityId, normalizeGatewayUrl } from '@/api/gateway-client';

describe('normalizeGatewayUrl', () => {
  it('normalizes a trusted LAN Gateway origin', () => {
    expect(normalizeGatewayUrl('  http://192.168.1.20:4310/  ')).toBe('http://192.168.1.20:4310');
  });

  it.each([
    '192.168.1.20:4310',
    'ftp://192.168.1.20',
    'http://user:secret@192.168.1.20:4310',
    'http://192.168.1.20:4310/v1',
    'http://192.168.1.20:4310?token=secret',
  ])('rejects an unsafe or incomplete address: %s', (address) => {
    expect(() => normalizeGatewayUrl(address)).toThrow();
  });
});

describe('GatewayClient authentication', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the device token as a bearer credential', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ projects: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await new GatewayClient('https://gateway.example.com').projects('device-token-value');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/v1/projects',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer device-token-value' }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('X-API-Key');
  });

  it('exchanges a pairing code without authorization', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          device: { id: 'device-1', name: 'Ouyang Android' },
          token: 'paired-device-token',
          tokenType: 'Bearer',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await new GatewayClient('https://gateway.example.com').pair('123456', 'Ouyang Android');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.com/v1/pairing/exchange',
      expect.objectContaining({
        body: JSON.stringify({ code: '123456', deviceName: 'Ouyang Android' }),
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      }),
    );
  });

  it('sends ready attachment IDs with a chat message', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: 'request-1',
          message: {
            id: '10000000-0000-4000-8000-000000000001',
            sessionId: '10000000-0000-4000-8000-000000000002',
            role: 'user',
            content: '分析图片',
            isPartial: false,
            createdAt: '2026-09-14T00:00:00.000Z',
          },
          session: {
            id: '10000000-0000-4000-8000-000000000002',
            projectId: 'home',
            projectDisplayName: 'home',
            title: '分析图片',
            status: 'running',
            lastMessagePreview: '分析图片',
            createdAt: '2026-09-14T00:00:00.000Z',
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await new GatewayClient('https://gateway.example').sendMessage(
      'device-token',
      '10000000-0000-4000-8000-000000000002',
      '分析图片',
      'request-1',
      ['10000000-0000-4000-8000-000000000003'],
    );

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        requestId: 'request-1',
        message: '分析图片',
        attachmentIds: ['10000000-0000-4000-8000-000000000003'],
      }),
    );
  });

  it('sends multimodal capability flags when creating a model', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: 'model-request',
          model: {
            id: '10000000-0000-4000-8000-000000000010',
            name: '视觉模型',
            baseUrl: 'https://api.example.com',
            model: 'vision-model',
            isActive: false,
            supportsImages: true,
            supportsDocuments: true,
            isMultimodalDefault: true,
            createdAt: '2026-09-14T00:00:00.000Z',
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await new GatewayClient('https://gateway.example').createModel('device-token', {
      requestId: 'model-request',
      name: '视觉模型',
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
      model: 'vision-model',
      supportsImages: true,
      supportsDocuments: true,
      isMultimodalDefault: true,
    });

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        requestId: 'model-request',
        name: '视觉模型',
        baseUrl: 'https://api.example.com',
        apiKey: 'secret',
        model: 'vision-model',
        supportsImages: true,
        supportsDocuments: true,
        isMultimodalDefault: true,
      }),
    );
  });

  it('creates a schedule draft without creating a task automatically', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: 'draft-1',
          draft: {
            name: '每日榜单',
            prompt: '获取最新 GitHub 榜单。',
            schedule: { kind: 'daily', hour: 9, minute: 0 },
            timeZone: 'Asia/Shanghai',
            projectId: 'home',
            workingDirectory: 'myclaude',
            modelId: null,
            allowAutoWrite: false,
            missingFields: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await new GatewayClient('https://gateway.example').scheduledTaskDraft(
      'device-token',
      {
        requestId: 'draft-1',
        text: '每天九点获取最新 GitHub 榜单',
        timeZone: 'Asia/Shanghai',
        projectId: 'home',
        workingDirectory: 'myclaude',
        modelId: null,
      },
    );

    expect(response.draft.schedule).toEqual({ kind: 'daily', hour: 9, minute: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example/v1/scheduled-tasks/draft',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          requestId: 'draft-1',
          text: '每天九点获取最新 GitHub 榜单',
          timeZone: 'Asia/Shanghai',
          projectId: 'home',
          workingDirectory: 'myclaude',
          modelId: null,
        }),
      }),
    );
  });

  it('registers an Expo push token for the authenticated device', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: 'push-1',
          subscription: {
            deviceId: 'device-1',
            provider: 'expo',
            platform: 'android',
            enabled: true,
            updatedAt: '2026-09-16T01:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await new GatewayClient('https://gateway.example').registerPushSubscription(
      'device-token',
      'ExponentPushToken[test]',
      'push-1',
    );

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        requestId: 'push-1',
        provider: 'expo',
        platform: 'android',
        token: 'ExponentPushToken[test]',
      }),
    );
  });
});

describe('GatewayClient attachment upload', () => {
  it('creates RFC 4122 draft IDs without native crypto support', () => {
    expect(createEntityId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('uploads multipart data and reports progress', async () => {
    const OriginalXhr = globalThis.XMLHttpRequest;
    const progress: number[] = [];
    let openedRequest: { method: string; url: string } | null = null;

    class MockXmlHttpRequest {
      public status = 201;
      public responseText = JSON.stringify({
        requestId: 'upload-1',
        attachment: {
          id: '10000000-0000-4000-8000-000000000003',
          kind: 'image',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
          size: 2048,
          status: 'ready',
          previewAvailable: true,
          createdAt: '2026-09-14T00:00:00.000Z',
        },
      });
      public timeout = 0;
      public upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
      public onerror: (() => void) | null = null;
      public ontimeout: (() => void) | null = null;
      public onabort: (() => void) | null = null;
      public onload: (() => void) | null = null;
      public method = '';
      public url = '';

      public open(method: string, url: string) {
        this.method = method;
        this.url = url;
        openedRequest = { method, url };
      }

      public setRequestHeader() {}

      public abort() {
        this.onabort?.();
      }

      public send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 } as ProgressEvent);
        this.onload?.();
      }
    }

    (globalThis as unknown as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
      MockXmlHttpRequest as unknown as typeof XMLHttpRequest;
    try {
      const attachment = await new GatewayClient('https://gateway.example').uploadAttachment(
        'device-token',
        {
          uri: 'file:///photo.jpg',
          name: 'photo.jpg',
          mimeType: 'image/jpeg',
          draftId: '10000000-0000-4000-8000-000000000004',
          requestId: 'upload-1',
          onProgress: (value) => progress.push(value),
        },
      );

      expect(attachment.id).toBe('10000000-0000-4000-8000-000000000003');
      expect(progress).toEqual([0.5, 1]);
      expect(openedRequest).toEqual({
        method: 'POST',
        url: 'https://gateway.example/v1/attachments',
      });
    } finally {
      (globalThis as unknown as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
        OriginalXhr;
    }
  });
});
