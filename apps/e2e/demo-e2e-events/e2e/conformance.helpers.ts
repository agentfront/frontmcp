/**
 * Shared setup of the conformance specs: the test-only conformance server, callers with their own tokens, raw
 * 2026-07-28 requests whose headers a test controls, and a reader for the SSE body of `events/stream`.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'http';
import type { AddressInfo } from 'net';

import { McpTestClient, MockOAuthServer, TestServer, TestTokenFactory } from '@frontmcp/testing';

export const PROTOCOL_20260728 = '2026-07-28';
export const EVENTS_EXTENSION = 'io.modelcontextprotocol/events';
export const SUBSCRIPTION_ID_META = 'io.modelcontextprotocol/subscriptionId';
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** The two ways a client reaches the server: an `initialize` session, or stateless requests of 2026-07-28. */
export type ProtocolPath = 'initialize session' | '2026-07-28';
export const PROTOCOL_PATHS: ProtocolPath[] = ['initialize session', '2026-07-28'];

export interface RpcError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface RpcReply {
  result?: Record<string, unknown>;
  error?: RpcError;
}

export interface WireMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: RpcError;
}

export interface CallerOptions {
  roles?: string[];
  tenantId?: string;
  path?: ProtocolPath;
  platform?: 'openai';
}

/** An `events/stream` request whose response is read frame by frame. */
export interface OpenStream {
  response: Response;
  /** Every JSON-RPC message read so far. */
  readonly messages: WireMessage[];
  /** The SSE comment lines read so far. */
  readonly comments: string[];
  /** Whether the server ended the response. */
  readonly ended: boolean;
  /** The first message that `matches`, waiting up to `timeoutMs` for it. */
  waitFor(matches: (message: WireMessage) => boolean, timeoutMs?: number): Promise<WireMessage>;
  /** Wait up to `timeoutMs` for the server to end the response; answers whether it did. */
  waitForEnd(timeoutMs?: number): Promise<boolean>;
  close(): Promise<void>;
}

/** The test-only conformance server, its identity provider, and what a test opened against it. */
export class ConformanceServer {
  private readonly clients: McpTestClient[] = [];
  private readonly streams: OpenStream[] = [];
  private nextRequestId = 1;

  /** Use `ConformanceServer.start()`. */
  private constructor(
    readonly server: TestServer,
    private readonly oauth: MockOAuthServer,
    private readonly tokens: TestTokenFactory,
  ) {}

  /** Start the identity provider and `main.conformance.ts` with extra environment variables. */
  static async start(env: Record<string, string> = {}): Promise<ConformanceServer> {
    let tokens = new TestTokenFactory({ issuer: 'http://localhost', audience: 'frontmcp-test' });
    let oauth = new MockOAuthServer(tokens, { debug: false });
    const firstInfo = await oauth.start();
    await oauth.stop();

    tokens = new TestTokenFactory({ issuer: firstInfo.issuer, audience: firstInfo.issuer });
    oauth = new MockOAuthServer(tokens, { debug: false, port: firstInfo.port });
    const oauthInfo = await oauth.start();

    const server = await TestServer.start({
      project: 'demo-e2e-events',
      command: 'npx tsx apps/e2e/demo-e2e-events/src/main.conformance.ts',
      env: { IDP_PROVIDER_URL: oauthInfo.baseUrl, IDP_EXPECTED_AUDIENCE: oauthInfo.issuer, ...env },
      startupTimeout: 30000,
      debug: false,
    });
    return new ConformanceServer(server, oauth, tokens);
  }

  get baseUrl(): string {
    return this.server.info.baseUrl;
  }

  /** A token for a subject, with its roles and tenant. */
  token(sub: string, options: CallerOptions = {}): Promise<string> {
    const claims = { roles: options.roles ?? [], ...(options.tenantId && { tenantId: options.tenantId }) };
    return this.tokens.createTestToken({ sub, claims });
  }

  /** A connected client for a subject, or an anonymous one, over the given protocol path. */
  async connect(sub: string | undefined, options: CallerOptions = {}): Promise<McpTestClient> {
    const auth = sub === undefined ? {} : { auth: { token: await this.token(sub, options) } };
    let builder = McpTestClient.create({ baseUrl: this.baseUrl, transport: 'streamable-http', ...auth });
    if (options.path === '2026-07-28') builder = builder.withProtocolVersion(PROTOCOL_20260728);
    if (options.platform) builder = builder.withPlatform(options.platform);
    const client = await builder.buildAndConnect();
    this.clients.push(client);
    return client;
  }

  /** A JSON-RPC request through a client, answered with its result or its error. */
  async rpc(client: McpTestClient, method: string, params: Record<string, unknown>): Promise<RpcReply> {
    const id = `conformance-${this.nextRequestId++}`;
    return (await client.raw.request({ jsonrpc: '2.0', id, method, params })) as RpcReply;
  }

  /** Call a test-only control tool and answer its JSON result; a tool error fails the test. */
  async control<T = Record<string, unknown>>(client: McpTestClient, name: string, args: Record<string, unknown>) {
    const result = await client.tools.call(name, args);
    if (result.isError) throw new Error(`${name} failed: ${result.text() ?? 'no message'}`);
    return result.json<T>();
  }

  /** A raw 2026-07-28 POST; `mcpName` overrides the `Mcp-Name` header, and `null` leaves it out. */
  post(
    method: string,
    params: Record<string, unknown>,
    options: { token?: string; mcpName?: string | null; id?: number | string; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const name = options.mcpName === undefined ? params['name'] : options.mcpName;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_20260728,
      'mcp-method': method,
      ...(typeof name === 'string' && { 'mcp-name': name }),
      ...(options.token && { authorization: `Bearer ${options.token}` }),
    };
    const meta = { 'io.modelcontextprotocol/protocolVersion': PROTOCOL_20260728 };
    return fetch(this.baseUrl, {
      method: 'POST',
      signal: options.signal,
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: options.id ?? this.nextRequestId++,
        method,
        params: { ...params, _meta: meta },
      }),
    });
  }

  /** Open `events/stream` under 2026-07-28 and read its SSE body as it arrives. */
  async openStream(token: string, params: Record<string, unknown>, id: number = this.nextRequestId++) {
    const controller = new AbortController();
    const response = await this.post('events/stream', params, { token, id, signal: controller.signal });
    const stream = readStream(response, controller);
    this.streams.push(stream);
    return stream;
  }

  /** Close what the last test opened. */
  async closeAll(): Promise<void> {
    await Promise.all(this.streams.splice(0).map((stream) => stream.close()));
    await Promise.all(this.clients.splice(0).map((client) => client.disconnect()));
  }

  /** Stop the server and the identity provider. */
  async stop(): Promise<void> {
    await this.closeAll();
    await this.server.stop();
    await this.oauth.stop();
  }
}

/** Read an SSE response in the background, keeping its messages and comment lines. */
function readStream(response: Response, controller: AbortController): OpenStream {
  const messages: WireMessage[] = [];
  const comments: string[] = [];
  let ended = false;
  const isSse = response.headers.get('content-type')?.includes('text/event-stream') ?? false;

  const reading = (async () => {
    if (!isSse) {
      messages.push((await response.json()) as WireMessage);
      return;
    }
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (reader) {
      const { value, done } = await reader.read();
      if (done) return;
      text += decoder.decode(value, { stream: true });
      const frames = text.split('\n\n');
      text = frames.pop() ?? '';
      for (const line of frames.flatMap((frame) => frame.split('\n'))) {
        if (line.startsWith(':')) comments.push(line);
        if (line.startsWith('data:')) messages.push(JSON.parse(line.slice('data:'.length).trim()) as WireMessage);
      }
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      ended = true;
    });

  return {
    response,
    messages,
    comments,
    get ended() {
      return ended;
    },
    async waitFor(matches, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = messages.find(matches);
        if (found) return found;
        if (ended || Date.now() > deadline) throw new Error(`No matching stream message in ${timeoutMs} ms`);
        await delay(20);
      }
    },
    async waitForEnd(timeoutMs = 5000) {
      await Promise.race([reading, delay(timeoutMs)]);
      return ended;
    },
    async close() {
      controller.abort();
      await reading;
    },
  };
}

/** Wait `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until `condition` holds, polling, for up to `timeoutMs`. */
export async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Condition not met in ${timeoutMs} ms`);
    await delay(20);
  }
}

/** A request a scripted callback received. */
export interface ScriptedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** An answer a scripted callback gives. */
export interface ScriptedAnswer {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** A callback on 127.0.0.1 that records every request and answers as a test scripts it. */
export class ScriptedCallback {
  readonly requests: ScriptedRequest[] = [];
  private server: Server | undefined;
  private origin = '';

  /** A callback that answers each request with `answer`. */
  constructor(private readonly answer: (request: ScriptedRequest) => ScriptedAnswer) {}

  /** The callback URL for a path. */
  url(path = '/hooks/scripted'): string {
    return `${this.origin}${path}`;
  }

  /** Listen on an ephemeral port. */
  async start(): Promise<void> {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const recorded = {
          method: request.method ?? '',
          path: (request.url ?? '/').split('?')[0],
          headers: request.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        this.requests.push(recorded);
        const { status, headers, body } = this.answer(recorded);
        response.writeHead(status, { 'content-type': 'application/json', ...headers });
        response.end(body === undefined ? '' : JSON.stringify(body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    this.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  /** Stop listening. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

/** The path of the document a receiver may serve to consent to deliveries without a challenge. */
export const WELL_KNOWN_RECEIVER_PATH = '/.well-known/mcp-webhook-receiver.json';

/** Whether a request is a webhook POST, not the well-known document the server may read first. */
export function isWebhookPost(request: ScriptedRequest): boolean {
  return request.path !== WELL_KNOWN_RECEIVER_PATH;
}

/** The answer of a callback that serves no well-known document, echoes a challenge and accepts everything else. */
export function echoChallenge(request: ScriptedRequest): ScriptedAnswer {
  if (!isWebhookPost(request)) return { status: 404 };
  const json = JSON.parse(request.body || '{}') as { type?: string; challenge?: string };
  return json.type === 'verification'
    ? { status: 200, body: { challenge: json.challenge } }
    : { status: 200, body: {} };
}
