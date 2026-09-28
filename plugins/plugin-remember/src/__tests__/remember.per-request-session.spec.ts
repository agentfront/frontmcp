/**
 * `session` and `tool` memory of a caller without a session belong to the signed-in caller.
 *
 * Under MCP 2026-07-28 (and on the stateless web transport) the server mints a new session id for
 * every request of a static-key or anonymous caller. It counted as the verified session, so memory
 * was keyed by a value that lives one request: a static-key caller's `session` and `tool` values
 * were lost on its next request, and an anonymous caller got a per-request namespace instead of the
 * documented `RememberIdentityError`.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';
import { App, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import RememberPlugin from '../remember.plugin';
import { RememberAccessorToken } from '../remember.symbols';

const scopeSchema = z.enum(['session', 'tool']);

/** Stores `card` when given, and answers the card remembered in `scope`. */
@Tool({ name: 'card', inputSchema: { card: z.string().optional(), scope: scopeSchema } })
class CardTool extends ToolContext {
  async execute(input: { card?: string; scope: 'session' | 'tool' }) {
    const remember = this.get(RememberAccessorToken);
    if (input.card !== undefined) await remember.set('card', input.card, { scope: input.scope });
    return { card: (await remember.get<string>('card', { scope: input.scope })) ?? null };
  }
}

@App({
  id: 'wallet',
  name: 'Wallet',
  plugins: [RememberPlugin.init({ type: 'memory', skipLegacyPurge: true })],
  tools: [CardTool],
})
class WalletApp {}

const NOUR_KEY = 'sk-wallet-nour-0001';
const SAM_KEY = 'sk-wallet-sam-0002';

type Handler = (request: Request) => Promise<Response>;

function createHandler(withStaticKeys: boolean): Promise<Handler> {
  return FrontMcpInstance.createFetchHandler({
    info: { name: 'remember-per-request-session', version: '1.0.0' },
    apps: [WalletApp],
    ...(withStaticKeys ? { auth: { mode: 'static' as const, tokens: [NOUR_KEY, SAM_KEY] } } : {}),
    logging: { level: LogLevel.Off },
  });
}

let requestId = 1;

/** A `tools/call` over MCP 2026-07-28, answered with the tool's structured content or its error text. */
async function call2026(handler: Handler, args: Record<string, unknown>, key?: string): Promise<unknown> {
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': 'card',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId++,
        method: 'tools/call',
        params: {
          name: 'card',
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'remember-spec', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
  );
  return outcome(await response.text());
}

/** The same call from a client that speaks an earlier revision, on the stateless web transport. */
async function callLegacy(handler: Handler, args: Record<string, unknown>, key?: string): Promise<unknown> {
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: requestId++,
        method: 'tools/call',
        params: { name: 'card', arguments: args },
      }),
    }),
  );
  return outcome(await response.text());
}

function outcome(text: string): unknown {
  const data = text
    .split('\n')
    .find((line) => line.startsWith('data: '))
    ?.slice('data: '.length);
  const message = JSON.parse(data ?? text) as {
    result?: { isError?: boolean; structuredContent?: unknown; content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
  if (message.error) return `error: ${message.error.message}`;
  if (message.result?.isError) return `error: ${message.result.content?.map((part) => part.text).join(' ')}`;
  return message.result?.structuredContent;
}

describe.each([
  ['MCP 2026-07-28', call2026],
  ['the stateless web transport', callLegacy],
] as const)('Remember for a caller without a session, over %s', (_, call) => {
  let staticHandler: Handler;
  let publicHandler: Handler;

  beforeAll(async () => {
    staticHandler = await createHandler(true);
    publicHandler = await createHandler(false);
  });

  it.each(['session', 'tool'] as const)(
    'keeps a static-key caller’s %s memory across its requests, apart from another key',
    async (scope) => {
      await call(staticHandler, { card: `4242-${scope}`, scope }, NOUR_KEY);

      const [own, other] = [
        await call(staticHandler, { scope }, NOUR_KEY),
        await call(staticHandler, { scope }, SAM_KEY),
      ];

      expect({ own, other }).toEqual({ own: { card: `4242-${scope}` }, other: { card: null } });
    },
  );

  it.each(['session', 'tool'] as const)('refuses %s memory to an anonymous caller', async (scope) => {
    const result = await call(publicHandler, { card: '1111', scope });

    expect(result).toEqual(expect.stringContaining('without a verified session'));
  });
});

describe('Remember for an anonymous client with a session on the Node server', () => {
  let node: http.Server;
  let base: string;

  beforeAll(async () => {
    const app = (await FrontMcpInstance.createHandler({
      info: { name: 'remember-node-session', version: '1.0.0' },
      apps: [WalletApp],
      logging: { level: LogLevel.Off },
    })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      node.close(() => resolve());
      node.closeAllConnections();
    });
    // Let the server finish closing the sessions of the connections it just dropped.
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  function post(body: Record<string, unknown>, sessionId?: string): Promise<Response> {
    return fetch(`${base}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  async function openSession(): Promise<string> {
    const response = await post({
      jsonrpc: '2.0',
      id: requestId++,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'remember-spec', version: '1' } },
    });
    await response.text();
    const sessionId = response.headers.get('mcp-session-id');
    if (!sessionId) throw new Error(`initialize returned no session (HTTP ${response.status})`);
    await (await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId)).text();
    return sessionId;
  }

  async function card(sessionId: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await post(
      { jsonrpc: '2.0', id: requestId++, method: 'tools/call', params: { name: 'card', arguments: args } },
      sessionId,
    );
    return outcome(await response.text());
  }

  it.each(['session', 'tool'] as const)('keeps %s memory within the session, apart from another one', async (scope) => {
    const [mine, theirs] = [await openSession(), await openSession()];
    await card(mine, { card: `4242-${scope}`, scope });

    expect({ own: await card(mine, { scope }), other: await card(theirs, { scope }) }).toEqual({
      own: { card: `4242-${scope}` },
      other: { card: null },
    });
  });

  /** A legacy SSE session: responses arrive on the stream, requests go to the endpoint it names. */
  async function openSseSession() {
    const abort = new AbortController();
    const stream = await fetch(`${base}/sse`, { headers: { accept: 'text/event-stream' }, signal: abort.signal });
    if (!stream.body) throw new Error('the SSE stream has no body');
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';

    async function nextEvent(): Promise<{ event: string; data: string }> {
      for (;;) {
        const end = buffered.indexOf('\n\n');
        if (end >= 0) {
          const raw = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          const field = (name: string) =>
            raw
              .split('\n')
              .filter((line) => line.startsWith(`${name}:`))
              .map((line) => line.slice(name.length + 1).trim())
              .join('');
          return { event: field('event') || 'message', data: field('data') };
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('the SSE stream ended');
        buffered += decoder.decode(value, { stream: true });
      }
    }

    const endpoint = await nextEvent();
    const url = new URL(endpoint.data, base).toString();
    const send = (body: Record<string, unknown>) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify(body),
      });

    async function request(method: string, params: Record<string, unknown>): Promise<string> {
      const id = requestId++;
      await (await send({ jsonrpc: '2.0', id, method, params })).text();
      for (;;) {
        const event = await nextEvent();
        if (event.data && (JSON.parse(event.data) as { id?: number }).id === id) return event.data;
      }
    }

    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'remember-spec', version: '1' },
    });
    await (await send({ jsonrpc: '2.0', method: 'notifications/initialized' })).text();
    return {
      card: async (args: Record<string, unknown>) =>
        outcome(await request('tools/call', { name: 'card', arguments: args })),
      close: () => abort.abort(),
    };
  }

  it.each(['session', 'tool'] as const)('keeps %s memory within a legacy SSE session', async (scope) => {
    const [mine, theirs] = [await openSseSession(), await openSseSession()];
    try {
      await mine.card({ card: `5151-${scope}`, scope });

      expect({ own: await mine.card({ scope }), other: await theirs.card({ scope }) }).toEqual({
        own: { card: `5151-${scope}` },
        other: { card: null },
      });
    } finally {
      mine.close();
      theirs.close();
    }
  });
});
