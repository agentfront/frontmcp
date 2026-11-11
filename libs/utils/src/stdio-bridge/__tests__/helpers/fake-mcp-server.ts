import type { JsonRpcFrame } from '../../stdio-framer';
import type { BridgeLogger } from '../../types';

export const SERVER_REVISIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const CHANNEL_CAPABILITIES = { tools: { listChanged: true }, experimental: { 'claude/channel': {} } };
export const PLAIN_CAPABILITIES = { tools: { listChanged: true } };

export interface SeenRequest {
  method: string;
  headers: Record<string, string>;
  frame?: JsonRpcFrame;
}

/** A logger that records every call, so a spec can read what was logged. */
export function recordingLog(): jest.Mocked<BridgeLogger> {
  return {
    path: undefined,
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    reloadEvent: jest.fn(),
    close: jest.fn(async () => undefined),
  };
}

/** Let the promises and stream reads that are ready run. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/** A notification stream the fake server holds open: the spec writes frames to it, ends it, or breaks it. */
export class OpenStream {
  readonly body: ReadableStream<Uint8Array>;
  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  constructor(
    readonly sessionId: string | undefined,
    readonly signal: AbortSignal | undefined,
  ) {
    this.body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    signal?.addEventListener('abort', () => this.fail(new DOMException('This operation was aborted', 'AbortError')));
  }

  /** Write one frame as an SSE event. */
  send(frame: JsonRpcFrame): void {
    this.controller?.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(frame)}\n\n`));
  }

  /** End the stream as a server that closes it does. */
  end(): void {
    this.controller?.close();
  }

  /** Break the stream as a dropped connection does. */
  fail(error: Error): void {
    this.controller?.error(error);
  }
}

/** A JSON answer with the given extra headers. */
function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * A streamable-HTTP MCP endpoint behind a `fetch`. It starts a session per `initialize`, holds a notification
 * stream open per `GET`, and, like the SDK, answers `server/discover` only when its 2026-07-28 headers are sent.
 */
export class FakeMcpServer {
  readonly requests: SeenRequest[] = [];
  readonly streams: OpenStream[] = [];
  capabilities: Record<string, unknown> = PLAIN_CAPABILITIES;
  /** Whether it answers a 2026-07-28 request at all. */
  speaks20260728 = true;
  /** How it answers the `GET` of a notification stream: by default it holds a stream open. */
  openStream: (stream: OpenStream) => Response | Promise<Response> = (stream) =>
    new Response(stream.body, { headers: { 'content-type': 'text/event-stream' } });
  private sessions = 0;

  /** The `fetch` to hand the upstream: it records each request, and answers it. */
  readonly fetch: typeof fetch = async (_input, init) => {
    const method = init?.method ?? 'GET';
    const headers = { ...(init?.headers as Record<string, string>) };
    const frame = typeof init?.body === 'string' ? (JSON.parse(init.body) as JsonRpcFrame) : undefined;
    this.requests.push({ method, headers, ...(frame ? { frame } : {}) });
    if (init?.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    if (method === 'GET') return this.answerStream(headers, init?.signal ?? undefined);
    if (method === 'DELETE' || !frame) return new Response(null, { status: 200 });
    return this.answerPost(frame, headers);
  };

  /** The requests of one HTTP method. */
  sent(method: string): SeenRequest[] {
    return this.requests.filter((request) => request.method === method);
  }

  /** The frames it was POSTed, in order. */
  postedFrames(): JsonRpcFrame[] {
    return this.sent('POST').map((request) => request.frame as JsonRpcFrame);
  }

  /** Answer a `GET`: a stream it remembers, handed to `openStream`. */
  private answerStream(headers: Record<string, string>, signal: AbortSignal | undefined): Response | Promise<Response> {
    const stream = new OpenStream(headers['mcp-session-id'], signal);
    this.streams.push(stream);
    return this.openStream(stream);
  }

  /** Answer a `POST` as a server of both eras does. */
  private answerPost(frame: JsonRpcFrame, headers: Record<string, string>): Response {
    if (frame.method === 'initialize') {
      this.sessions += 1;
      const params = frame.params as { protocolVersion: string };
      const result = { protocolVersion: params.protocolVersion, capabilities: this.capabilities };
      return jsonResponse({ jsonrpc: '2.0', id: frame.id, result }, { 'mcp-session-id': `session-${this.sessions}` });
    }
    if (frame.method === 'server/discover') {
      const mirrored = headers['mcp-protocol-version'] === '2026-07-28' && headers['mcp-method'] === frame.method;
      if (!this.speaks20260728 || !mirrored) return new Response(null, { status: 400 });
      const result = { supportedVersions: SERVER_REVISIONS, capabilities: this.capabilities };
      return jsonResponse({ jsonrpc: '2.0', id: frame.id, result });
    }
    if (frame.id === undefined) return new Response(null, { status: 202 });
    return jsonResponse({ jsonrpc: '2.0', id: frame.id, result: { answered: frame.method } });
  }
}
