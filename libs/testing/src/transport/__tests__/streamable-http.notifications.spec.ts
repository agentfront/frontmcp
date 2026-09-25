import { McpTestClient } from '../../client/mcp-test-client';

const BASE_URL = 'http://localhost:3005';
const FALLBACK_PROGRESS_TOKEN = 'import-progress';

interface SentMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: { _meta?: { progressToken?: string | number }; [key: string]: unknown };
}

const logNotification = {
  jsonrpc: '2.0',
  method: 'notifications/message',
  params: { level: 'info', data: 'Importing 2 files' },
};

function progressNotification(progressToken: string | number, progress: number) {
  return {
    jsonrpc: '2.0',
    method: 'notifications/progress',
    params: { progressToken, progress, total: 2, message: `file ${progress}` },
  };
}

function toSseStream(messages: unknown[]): string {
  return messages
    .map((message, index) => `event: message\nid: session-1:${index}\ndata: ${JSON.stringify(message)}\n\n`)
    .join('');
}

const listChangedNotification = { jsonrpc: '2.0', method: 'notifications/tools/list_changed' };

function initializeResponse(id: SentMessage['id']): Response {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test', version: '1.0.0' } },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
  });
}

function sessionStreamResponse(): Response {
  return new Response(toSseStream([listChangedNotification]), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function streamedToolCallResponse(request: SentMessage): Response {
  const progressToken = request.params?._meta?.progressToken ?? FALLBACK_PROGRESS_TOKEN;
  const finalResult = {
    jsonrpc: '2.0',
    id: request.id,
    result: { content: [{ type: 'text', text: JSON.stringify({ imported: 2 }) }] },
  };
  const stream = toSseStream([
    logNotification,
    progressNotification(progressToken, 1),
    progressNotification(progressToken, 2),
    finalResult,
  ]);
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function stubStreamingServer(): SentMessage[] {
  const sentMessages: SentMessage[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'GET') return sessionStreamResponse();
    const message = JSON.parse(String(init?.body)) as SentMessage;
    sentMessages.push(message);
    if (message.method === 'initialize') return initializeResponse(message.id);
    if (message.method === 'tools/call') return streamedToolCallResponse(message);
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  return sentMessages;
}

const connectedClients: McpTestClient[] = [];

async function connectClient(timeoutMs?: number): Promise<McpTestClient> {
  const builder = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true });
  const client = (timeoutMs === undefined ? builder : builder.withTimeout(timeoutMs)).build();
  connectedClients.push(client);
  await client.connect();
  return client;
}

function stubSessionStream(openSessionStream: (init: RequestInit | undefined) => Response | Promise<Response>): void {
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'GET') return openSessionStream(init);
    const message = JSON.parse(String(init?.body)) as SentMessage;
    if (message.method === 'initialize') return initializeResponse(message.id);
    return new Response(null, { status: 202 });
  }) as typeof fetch;
}

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('StreamableHttpTransport server notifications on SSE responses', () => {
  const realFetch = globalThis.fetch;

  afterEach(async () => {
    await Promise.all(connectedClients.splice(0).map((client) => client.disconnect()));
    globalThis.fetch = realFetch;
  });

  it('records notifications/message events streamed before the tools/call result', async () => {
    stubStreamingServer();
    const mcp = await connectClient();
    const notifications = mcp.notifications.collect();

    const result = await mcp.tools.call('import_files', {});

    expect(result.json()).toEqual({ imported: 2 });
    expect(notifications.received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: 'notifications/message', params: logNotification.params }),
      ]),
    );
  });

  it('records notifications/progress events streamed before the tools/call result', async () => {
    stubStreamingServer();
    const mcp = await connectClient();
    const progress = mcp.notifications.collectProgress();

    const result = await mcp.tools.call('import_files', {});

    expect(result.json()).toEqual({ imported: 2 });
    expect(progress.all).toEqual([
      expect.objectContaining({ progress: 1, total: 2 }),
      expect.objectContaining({ progress: 2, total: 2 }),
    ]);
  });

  it('sends a _meta.progressToken with tools/call while progress is being collected', async () => {
    const sentMessages = stubStreamingServer();
    const mcp = await connectClient();
    mcp.notifications.collectProgress();

    await mcp.tools.call('import_files', {});

    const toolCall = sentMessages.find((message) => message.method === 'tools/call');
    expect(toolCall?.params).toEqual(
      expect.objectContaining({ _meta: expect.objectContaining({ progressToken: expect.anything() }) }),
    );
  });

  it('sends an explicit progressToken without collecting progress', async () => {
    const sentMessages = stubStreamingServer();
    const mcp = await connectClient();

    await mcp.tools.call('import_files', {}, { progressToken: 'import-42' });

    const toolCall = sentMessages.find((message) => message.method === 'tools/call');
    expect(toolCall?.params?._meta).toEqual({ progressToken: 'import-42' });
  });

  it('sends no _meta when progress is not requested', async () => {
    const sentMessages = stubStreamingServer();
    const mcp = await connectClient();

    await mcp.tools.call('import_files', {});

    const toolCall = sentMessages.find((message) => message.method === 'tools/call');
    expect(toolCall?.params).not.toHaveProperty('_meta');
  });

  it('records notifications the server sends on the session stream', async () => {
    stubStreamingServer();
    const mcp = await connectClient();

    const listChanged = await mcp.notifications.collect().waitFor('notifications/tools/list_changed', 1000);

    expect(listChanged.method).toBe('notifications/tools/list_changed');
    await mcp.disconnect();
  });

  it('sends the negotiated MCP-Protocol-Version on the session stream request', async () => {
    const streamRequestHeaders: Array<Record<string, string>> = [];
    stubSessionStream((init) => {
      streamRequestHeaders.push(init?.headers as Record<string, string>);
      return sessionStreamResponse();
    });

    await connectClient();

    expect(streamRequestHeaders[0]).toEqual(expect.objectContaining({ 'MCP-Protocol-Version': '2025-06-18' }));
  });

  it('does not hold connect() on a session stream whose response never arrives, and aborts it on disconnect', async () => {
    let streamSignal: AbortSignal | undefined;
    stubSessionStream(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          streamSignal = init?.signal ?? undefined;
          streamSignal?.addEventListener('abort', () => reject(streamSignal?.reason));
        }),
    );

    const mcp = await connectClient(200);
    await mcp.disconnect();

    expect(streamSignal?.aborted).toBe(true);
  });

  it('reopens the session stream after the server ends it', async () => {
    let streamRequestCount = 0;
    stubSessionStream(() => {
      streamRequestCount += 1;
      return sessionStreamResponse();
    });

    await connectClient();

    await waitUntil(() => streamRequestCount >= 2, 2000);
    expect(streamRequestCount).toBeGreaterThanOrEqual(2);
  });

  it('reads session stream events separated by CRLF, even when a line ending is split across chunks', async () => {
    const eventData = JSON.stringify(listChangedNotification);
    stubSessionStream(
      () =>
        new Response(chunkedStream([`event: message\r\ndata: ${eventData}\r`, '\n\r\n']), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const mcp = await connectClient();

    const listChanged = await mcp.notifications.collect().waitFor('notifications/tools/list_changed', 1000);

    expect(listChanged.method).toBe('notifications/tools/list_changed');
  });
});
