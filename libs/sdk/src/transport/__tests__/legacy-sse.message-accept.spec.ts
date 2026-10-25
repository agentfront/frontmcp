import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { MCP_20260728_META, PROTOCOL_2026_07_28 } from '@frontmcp/protocol';
import { Client, SSEClientTransport } from '@frontmcp/protocol/client';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [PingTool] })
class DeskApp {}

const ENTRY_PATH = '/mcp';
const BOTH_MEDIA_TYPES = 'application/json, text/event-stream';

let server: http.Server;
let origin: string;
const openStreams: AbortController[] = [];

beforeAll(async () => {
  const handler = (await FrontMcpInstance.createHandler({
    info: { name: 'legacy-sse-message-accept', version: '1.0.0' },
    apps: [DeskApp],
    http: { entryPath: ENTRY_PATH },
    logging: { level: LogLevel.Off },
  })) as http.RequestListener;
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const stream of openStreams) stream.abort();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
});

interface JsonRpcMessage {
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface PostResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function post(url: URL, message: unknown, headers: http.OutgoingHttpHeaders): Promise<PostResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', ...headers } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify(message));
  });
}

function acceptHeader(accept: string | undefined): http.OutgoingHttpHeaders {
  return accept === undefined ? {} : { accept };
}

function eventData(event: string): string {
  return event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('');
}

function parseJsonRpcResponse(response: PostResponse): JsonRpcMessage {
  const contentType = response.headers['content-type'] ?? '';
  if (!contentType.includes('text/event-stream')) return JSON.parse(response.body) as JsonRpcMessage;
  const messages = response.body
    .split(/\r?\n\r?\n/)
    .map(eventData)
    .filter(Boolean);
  return JSON.parse(messages[messages.length - 1]) as JsonRpcMessage;
}

interface LegacySseStream {
  endpoint: URL;
  nextMessage(): Promise<JsonRpcMessage>;
}

async function openLegacySseStream(): Promise<LegacySseStream> {
  const abort = new AbortController();
  openStreams.push(abort);
  const response = await fetch(`${origin}${ENTRY_PATH}/sse`, {
    headers: { accept: 'text/event-stream' },
    signal: abort.signal,
  });
  if (!response.body) throw new Error('the SSE stream has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  async function nextEventData(): Promise<string> {
    for (;;) {
      const eventEnd = buffered.indexOf('\n\n');
      if (eventEnd >= 0) {
        const data = eventData(buffered.slice(0, eventEnd));
        buffered = buffered.slice(eventEnd + 2);
        if (data) return data;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('the SSE stream ended');
      buffered += decoder.decode(value, { stream: true });
    }
  }

  const endpoint = new URL(await nextEventData(), origin);
  return { endpoint, nextMessage: async () => JSON.parse(await nextEventData()) as JsonRpcMessage };
}

function initializeRequest(id: number, protocolVersion: string) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'accept-spec', version: '1.0.0' } },
  };
}

describe('the legacy HTTP+SSE message endpoint under an entry path', () => {
  it('is the endpoint the SSE stream names', async () => {
    const stream = await openLegacySseStream();

    expect(stream.endpoint.pathname).toBe(`${ENTRY_PATH}/message`);
    expect(stream.endpoint.searchParams.get('sessionId')).toBeTruthy();
  });

  it.each([
    ['application/json', 'application/json'],
    ['text/event-stream', 'text/event-stream'],
    ['*/*', '*/*'],
    ['application/*', 'application/*'],
    ['no Accept header', undefined],
  ])('accepts a post with %s and answers on the stream', async (_label, accept) => {
    const stream = await openLegacySseStream();

    const response = await post(stream.endpoint, initializeRequest(1, '2024-11-05'), acceptHeader(accept));

    expect(response.status).toBe(202);
    expect(await stream.nextMessage()).toMatchObject({ id: 1, result: { protocolVersion: '2024-11-05' } });
  });

  it('serves a whole session posted with Accept */*', async () => {
    const stream = await openLegacySseStream();
    const anyMediaType = acceptHeader('*/*');

    const initializeResponse = await post(stream.endpoint, initializeRequest(1, '2024-11-05'), anyMediaType);
    expect(initializeResponse.status).toBe(202);
    await stream.nextMessage();
    await post(stream.endpoint, { jsonrpc: '2.0', method: 'notifications/initialized' }, anyMediaType);
    const callResponse = await post(
      stream.endpoint,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ping', arguments: {} } },
      anyMediaType,
    );

    expect(callResponse.status).toBe(202);
    expect(await stream.nextMessage()).toMatchObject({ id: 2, result: { structuredContent: { pong: true } } });
  });

  it('serves the official SDK SSE client with its default headers', async () => {
    const client = new Client({ name: 'sse-default-headers', version: '1.0.0' });
    await client.connect(new SSEClientTransport(new URL(`${origin}${ENTRY_PATH}/sse`)));
    try {
      const { tools } = await client.listTools();
      const result = await client.callTool({ name: 'ping', arguments: {} });

      expect(tools.map((tool) => tool.name)).toContain('ping');
      expect(result).toMatchObject({ structuredContent: { pong: true } });
    } finally {
      await client.close();
    }
  });
});

describe('a Streamable HTTP post to the entry path keeps its Accept rules', () => {
  const entryUrl = () => new URL(`${origin}${ENTRY_PATH}`);

  it('serves initialize that lists both media types', async () => {
    const response = await post(entryUrl(), initializeRequest(1, '2025-06-18'), { accept: BOTH_MEDIA_TYPES });

    expect(response.status).toBe(200);
    expect(response.headers['mcp-session-id']).toBeTruthy();
    expect(parseJsonRpcResponse(response)).toMatchObject({ id: 1, result: { protocolVersion: '2025-06-18' } });
  });

  it.each(['*/*', 'application/*'])('does not serve initialize with Accept %s', async (accept) => {
    const response = await post(entryUrl(), initializeRequest(1, '2025-06-18'), { accept });

    expect(response.status).toBe(404);
    expect(response.headers['mcp-session-id']).toBeUndefined();
  });

  it('serves an MCP 2026-07-28 request that lists both media types', async () => {
    const response = await post(
      entryUrl(),
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            [MCP_20260728_META.protocolVersion]: PROTOCOL_2026_07_28,
            [MCP_20260728_META.clientInfo]: { name: 'accept-spec', version: '1.0.0' },
            [MCP_20260728_META.clientCapabilities]: {},
          },
        },
      },
      { accept: BOTH_MEDIA_TYPES, 'mcp-protocol-version': PROTOCOL_2026_07_28, 'mcp-method': 'tools/list' },
    );

    expect(response.status).toBe(200);
    expect(response.headers['mcp-session-id']).toBeUndefined();
    expect(parseJsonRpcResponse(response)).toMatchObject({ id: 1, result: { tools: [{ name: 'ping' }] } });
  });
});
