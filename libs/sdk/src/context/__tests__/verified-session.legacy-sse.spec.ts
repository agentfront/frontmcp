/**
 * A legacy SSE session is a verified session.
 *
 * An SSE client posts its messages to `/message?sessionId=<id>`, with no `mcp-session-id` header, so
 * the request context runs under a per-request id while session verification accepts the session
 * from the query. `FrontMcpContext.verifiedSessionId` required the two to match, so it never
 * matched an SSE session: everything that reads it (guard partitions, the approval and cache
 * plugins) treated SSE clients as sessionless.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { useMidRateLimitWindow } from '../../__test-utils__/helpers/rate-limit-window.helpers';
import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@Tool({ name: 'whoami', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { verifiedSessionId: this.context.verifiedSessionId ?? null };
  }
}

/** One call per session a minute. */
@Tool({ name: 'once', inputSchema: {}, rateLimit: { maxRequests: 1, windowMs: 60_000, partitionBy: 'session' } })
class OnceTool extends ToolContext {
  async execute() {
    return { ran: true };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool, OnceTool] })
class DeskApp {}

let node: http.Server;
let base: string;
let requestId = 1;
const open: AbortController[] = [];

beforeAll(async () => {
  const app = (await FrontMcpInstance.createHandler({
    info: { name: 'legacy-sse-session', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
  })) as http.RequestListener;
  node = http.createServer(app);
  await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const controller of open) controller.abort();
  await new Promise<void>((resolve) => {
    node.close(() => resolve());
    node.closeAllConnections();
  });
  // Let the server finish closing the sessions of the connections it just dropped.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

interface SseSession {
  sessionId: string;
  call(name: string): Promise<Record<string, unknown>>;
}

/** A legacy SSE session: responses arrive on the stream, requests go to the endpoint it names. */
async function openSseSession(): Promise<SseSession> {
  const abort = new AbortController();
  open.push(abort);
  const stream = await fetch(`${base}/sse`, { headers: { accept: 'text/event-stream' }, signal: abort.signal });
  if (!stream.body) throw new Error('the SSE stream has no body');
  const reader = stream.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';

  async function nextData(): Promise<string> {
    for (;;) {
      const end = buffered.indexOf('\n\n');
      if (end >= 0) {
        const raw = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        return raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice('data:'.length).trim())
          .join('');
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('the SSE stream ended');
      buffered += decoder.decode(value, { stream: true });
    }
  }

  const endpoint = new URL(await nextData(), base);
  const sessionId = endpoint.searchParams.get('sessionId') ?? '';
  const send = (body: Record<string, unknown>) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    });

  async function request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = requestId++;
    await (await send({ jsonrpc: '2.0', id, method, params })).text();
    for (;;) {
      const data = await nextData();
      if (!data) continue;
      const message = JSON.parse(data) as { id?: number; result?: Record<string, unknown>; error?: unknown };
      if (message.id === id) return message.result ?? { error: message.error };
    }
  }

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'sse', version: '1' },
  });
  await (await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).text();
  return {
    sessionId,
    call: async (name) => {
      const result = await request('tools/call', { name, arguments: {} });
      if (result['isError']) {
        return { error: (result['content'] as Array<{ text?: string }>).map((part) => part.text).join(' ') };
      }
      return result['structuredContent'] as Record<string, unknown>;
    },
  };
}

describe('a legacy SSE session', () => {
  useMidRateLimitWindow(60_000);

  it('is the verified session of the requests posted to it', async () => {
    const session = await openSseSession();

    expect(await session.call('whoami')).toEqual({ verifiedSessionId: session.sessionId });
  });

  it('is its own rate-limit partition, apart from another SSE session', async () => {
    const [first, second] = [await openSseSession(), await openSseSession()];

    expect([await first.call('once'), await second.call('once')]).toEqual([{ ran: true }, { ran: true }]);
  });

  it('still limits the requests of one session', async () => {
    const session = await openSseSession();
    await session.call('once');

    expect(await session.call('once')).toEqual({ error: expect.stringMatching(/rate limit/i) });
  });
});
