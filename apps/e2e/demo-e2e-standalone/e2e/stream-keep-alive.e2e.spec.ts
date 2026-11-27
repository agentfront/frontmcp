/**
 * E2E: an open MCP stream sends keep-alive comments at `transport.sse.heartbeatMs` while it has nothing else to send,
 * so a proxy's idle timeout does not cut a long tool call (#1479). The server's heartbeat is 300 ms and its tool waits
 * 1.2 s without a byte: the Streamable HTTP response and `GET` streams, the 2026-07-28 request stream and the legacy
 * SSE stream each receive comments, and the call's answer still arrives whole.
 */
import { expect, test } from '@frontmcp/testing';

const JSON_AND_SSE = 'application/json, text/event-stream';
const decoder = new TextDecoder();

/** Reads `response` until `done` holds for what came so far, failing after five seconds; then stops reading. */
async function readUntil(response: Response, done: (text: string) => boolean): Promise<string> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  let text = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => (timer = setTimeout(resolve, 5_000, 'timeout')));
  try {
    while (!done(text)) {
      const step = await Promise.race([reader.read(), timedOut]);
      if (step === 'timeout') throw new Error(`the stream sent only: ${JSON.stringify(text)}`);
      if (step.done) throw new Error(`the stream ended after: ${JSON.stringify(text)}`);
      text += decoder.decode(step.value, { stream: true });
    }
    return text;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
  }
}

/** The whole SSE frames in `text`, without their blank-line ends; a frame still arriving is left out. */
const framesOf = (text: string): string[] => text.split('\n\n').slice(0, -1);

type Answer = { id?: unknown; result?: { content?: { text?: string }[] } };

/** The JSON-RPC messages of the stream's whole `event: message` frames. */
function messagesOf(text: string): Answer[] {
  return framesOf(text)
    .filter((frame) => frame.startsWith('event: message'))
    .map((frame) => JSON.parse(frame.slice(frame.indexOf('data: ') + 'data: '.length)) as Answer);
}

/** Whether the stream's whole frames so far hold the message that answers `id`. */
const answered = (text: string, id: number): boolean => messagesOf(text).some((message) => message.id === id);

/** The JSON-RPC message of the stream's `event: message` that answers `id`. */
function answerOf(text: string, id: number): Answer {
  const data = messagesOf(text).find((message) => message.id === id);
  if (!data) throw new Error(`no answer to request ${id} in: ${JSON.stringify(text)}`);
  return data;
}

/** How many of `frames` are the comment `comment`. */
const comments = (frames: string[], comment: string) => frames.filter((frame) => frame === comment).length;

/** The whole frames before the first `event: message`. */
function framesBeforeMessage(text: string): string[] {
  const frames = framesOf(text);
  const first = frames.findIndex((frame) => frame.startsWith('event: message'));
  return first === -1 ? frames : frames.slice(0, first);
}

async function initializedSession(baseUrl: string): Promise<Record<string, string>> {
  const init = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: JSON_AND_SSE },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'keep-alive-e2e', version: '1' } },
    }),
  });
  await init.text();
  const headers = {
    'content-type': 'application/json',
    accept: JSON_AND_SSE,
    'mcp-session-id': init.headers.get('mcp-session-id') as string,
    'mcp-protocol-version': '2025-06-18',
  };
  const initialized = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  await initialized.text();
  return headers;
}

test.describe('MCP stream keep-alive', () => {
  test.use({
    server: 'apps/e2e/demo-e2e-standalone/src/main-keepalive.ts',
    project: 'demo-e2e-standalone',
    publicMode: true,
  });

  test('keeps a Streamable HTTP response stream alive while a quiet tool runs', async ({ server }) => {
    const headers = await initializedSession(server.info.baseUrl);
    const response = await fetch(`${server.info.baseUrl}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'slow-wait', arguments: { ms: 1200 } },
      }),
    });

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await readUntil(response, (sent) => answered(sent, 2));
    expect(comments(framesBeforeMessage(text), ': keepalive')).toBeGreaterThanOrEqual(2);
    expect(answerOf(text, 2).result?.content?.[0]?.text).toContain('waited 1200 ms');
  });

  test('keeps the standalone GET stream alive', async ({ server }) => {
    const headers = await initializedSession(server.info.baseUrl);
    const response = await fetch(`${server.info.baseUrl}/`, {
      headers: { ...headers, accept: 'text/event-stream' },
    });

    expect(response.status).toBe(200);
    const frames = framesOf(await readUntil(response, (sent) => comments(framesOf(sent), ': keepalive') >= 2));
    expect(frames.filter((frame) => frame !== ': keepalive')).toEqual([]);
  });

  test('keeps a 2026-07-28 request stream alive while a quiet tool runs', async ({ server }) => {
    const response = await fetch(`${server.info.baseUrl}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: JSON_AND_SSE,
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'slow-wait',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'slow-wait',
          arguments: { ms: 1200 },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'keep-alive-e2e', version: '1' },
            'io.modelcontextprotocol/clientCapabilities': {},
            progressToken: 'keep-alive-3',
          },
        },
      }),
    });

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await readUntil(response, (sent) => answered(sent, 3));
    expect(comments(framesBeforeMessage(text), ': keep-alive')).toBeGreaterThanOrEqual(2);
    expect(answerOf(text, 3).result?.content?.[0]?.text).toContain('waited 1200 ms');
  });

  test('keeps the legacy SSE stream alive after its endpoint event', async ({ server }) => {
    const response = await fetch(`${server.info.baseUrl}/sse`, { headers: { accept: 'text/event-stream' } });

    expect(response.status).toBe(200);
    const [endpoint, ...rest] = framesOf(
      await readUntil(response, (sent) => comments(framesOf(sent), ': keep-alive') >= 2),
    );
    expect(endpoint).toMatch(/^id: 1\nevent: endpoint\ndata: [^\n]+$/);
    expect(rest.length).toBeGreaterThanOrEqual(2);
    expect(rest.filter((frame) => frame !== ': keep-alive')).toEqual([]);
  });
});
