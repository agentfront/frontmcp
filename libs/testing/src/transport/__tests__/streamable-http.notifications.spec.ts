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

function initializeResponse(id: SentMessage['id']): Response {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'test', version: '1.0.0' } },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
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
    const message = JSON.parse(String(init?.body)) as SentMessage;
    sentMessages.push(message);
    if (message.method === 'initialize') return initializeResponse(message.id);
    if (message.method === 'tools/call') return streamedToolCallResponse(message);
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  return sentMessages;
}

async function connectClient(): Promise<McpTestClient> {
  const client = McpTestClient.create({ baseUrl: BASE_URL, publicMode: true }).build();
  await client.connect();
  return client;
}

describe('StreamableHttpTransport server notifications on SSE responses', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
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
});
