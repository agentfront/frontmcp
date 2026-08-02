/**
 * `handle:mcp-20260728` — the request pipeline for MCP protocol revision 2026-07-28.
 *
 * This revision is stateless: there is no `initialize` handshake, no
 * `Mcp-Session-Id`, and no server→client request direction. Rather than bend
 * the session-oriented transports into that shape, it gets its own flow —
 * a sibling of `handle:streamable-http` / `handle:stateless-http`, hookable at
 * every stage like all the others, reached only when the request explicitly
 * declares the 2026-07-28 revision.
 *
 * Every earlier revision continues down its original flow untouched.
 *
 * @see https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
 */
import { z } from '@frontmcp/lazy-zod';
import { MCP_20260728_META, type LoggingLevel, type SubscriptionFilter } from '@frontmcp/protocol';

import {
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  httpOutputSchema,
  httpRespond,
  ServerRequestTokens,
  type Authorization,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { FrontMcpContextStorage } from '../../context';
import { type Scope } from '../../scope';
import {
  createSubscriptionStream,
  declaresProtocol20260728,
  dispatch20260728,
  isProtocol20260728Request,
  MCP_HEADERS,
  readHeader,
  RequestNotificationSink,
  toJsonRpcError,
  validate20260728Request,
  type JsonRpcErrorPayload,
} from '../mcp-20260728';

export const plan = {
  pre: ['parseInput', 'validate', 'router'],
  execute: ['handleNotification', 'handleSubscriptions', 'handleMessage'],
  post: [],
  finalize: ['cleanup'],
} as const satisfies FlowPlan<string>;

/**
 * `subscriptions/listen` params.
 *
 * Validated rather than cast: the filter reaches `new Set(...)` inside the
 * stream generator, so a non-array `resourceSubscriptions` would throw AFTER
 * the 200 and the SSE headers are already committed — the client would see a
 * truncated stream instead of a JSON-RPC error.
 */
const subscriptionParamsSchema = z.object({
  notifications: z
    .object({
      toolsListChanged: z.boolean().optional(),
      promptsListChanged: z.boolean().optional(),
      resourcesListChanged: z.boolean().optional(),
      resourceSubscriptions: z.array(z.string()).optional(),
    })
    .default({}),
});

/** JSON-RPC ids are strings or numbers; the id is echoed as the subscription id. */
const requestIdSchema = z.union([z.string(), z.number()]);

export const stateSchema = z.object({
  /** Negotiated protocol version for this request. */
  version: z.string().optional(),
  requestType: z.enum(['notification', 'subscriptions', 'message']).optional(),
  isAnonymous: z.boolean().default(true),
});

const name = 'handle:mcp-202607280728' as const;
const { Stage } = FlowHooksOf(name);

declare global {
  interface ExtendFlows {
    'handle:mcp-202607280728': FlowRunOptions<
      HandleMcp20260728Flow,
      typeof plan,
      typeof httpInputSchema,
      typeof httpOutputSchema,
      typeof stateSchema
    >;
  }
}

const encoder = new TextEncoder();

/** Serialize one JSON-RPC message as an SSE `message` event. */
function frame(message: unknown): Uint8Array {
  return encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

/** True when the client is willing to receive an SSE response stream. */
function acceptsEventStream(headers: Record<string, unknown> | undefined): boolean {
  const accept = readHeader(headers, 'accept');
  return typeof accept === 'string' && accept.includes('text/event-stream');
}

/**
 * OpenTelemetry context carried on `_meta` (SEP-414).
 *
 * The W3C names are used verbatim and echoed back on the result, so a client can
 * stitch its span to the server's without an out-of-band correlation id.
 */
const TRACE_META_KEYS = ['traceparent', 'tracestate', 'baggage'] as const;

export function extractTraceContext(meta: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const key of TRACE_META_KEYS) {
    if (typeof meta[key] === 'string') out[key] = meta[key] as string;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Stream a request's notifications followed by its final response.
 *
 * The dispatch runs concurrently with the drain loop so a long tool can report
 * progress while it works; the final JSON-RPC response terminates the stream,
 * as the transport spec prescribes.
 */
async function* streamMessageResponse(
  options: Parameters<typeof dispatch20260728>[0],
  sink: RequestNotificationSink,
  requestId: unknown,
  runInContext: (fn: () => Promise<void>) => Promise<void>,
): AsyncIterable<Uint8Array> {
  let outcome: Awaited<ReturnType<typeof dispatch20260728>> | undefined;
  let failure: unknown;

  // The stream body is drained by the response renderer, which runs AFTER the
  // flow has unwound out of its AsyncLocalStorage scope. Re-entering the
  // captured context is what keeps `this.tryGetContext()` — and therefore
  // `notify()` / `progress()` / `elicit()` — working inside the entry.
  const running = runInContext(async () => {
    try {
      outcome = await dispatch20260728(options);
    } catch (error: unknown) {
      failure = error;
    }
  }).finally(() => sink.close());

  while (!sink.closed) {
    await sink.waitForActivity();
    for (const notification of sink.drain()) {
      yield frame({ jsonrpc: '2.0', method: notification.method, params: notification.params });
    }
  }

  await running;

  // Anything queued between the last drain and close still belongs to this
  // request, so flush it before the terminating response.
  for (const notification of sink.drain()) {
    yield frame({ jsonrpc: '2.0', method: notification.method, params: notification.params });
  }

  const id = requestId ?? null;
  if (failure !== undefined) {
    const mapped = toJsonRpcError(failure);
    yield frame({ jsonrpc: '2.0', id, error: mapped.error });
    return;
  }
  if (outcome?.kind === 'error') {
    yield frame({ jsonrpc: '2.0', id, error: outcome.error });
    return;
  }
  yield frame({ jsonrpc: '2.0', id, result: outcome?.result });
}

/** Build the JSON-RPC error envelope for a failed 2026-07-28 request. */
function errorResponse(status: number, error: JsonRpcErrorPayload, id: unknown) {
  return httpRespond.json(
    {
      jsonrpc: '2.0',
      id: id === undefined ? null : id,
      error,
    },
    { status },
  );
}

@Flow({
  name,
  plan,
  access: 'public',
  inputSchema: httpInputSchema,
  outputSchema: httpOutputSchema,
})
export default class HandleMcp20260728Flow extends FlowBase<typeof name> {
  name = name;

  private get log() {
    return this.scope.logger.child('HandleMcp20260728Flow');
  }

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const auth = request[ServerRequestTokens.auth] as Authorization | undefined;

    this.state.set(
      stateSchema.parse({
        isAnonymous: !auth?.token || auth.token.length === 0 || auth.session?.payload?.isPublic === true,
      }),
    );
  }

  /**
   * Enforce the transport rules of this revision BEFORE any handler runs.
   *
   * Header/body agreement is a security control, not a formality: an
   * intermediary may route on `Mcp-Method` / `Mcp-Name` while the server
   * executes on the body, so a disagreement must be refused rather than
   * resolved in favour of one side.
   */
  @Stage('validate')
  async validate() {
    const { request } = this.rawInput;
    const method = request.method.toUpperCase();

    // GET and DELETE were the session-era verbs (standalone SSE stream and
    // session termination). Both are gone; the spec prescribes 405.
    if (method === 'GET' || method === 'DELETE') {
      this.respond({
        kind: 'text',
        status: 405,
        body: `HTTP ${method} is not supported by MCP protocol 2026-07-28`,
        contentType: 'text/plain; charset=utf-8',
        headers: { Allow: 'POST' },
      });
      return;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const scope = this.scope as unknown as Scope;

    // Strict only when the CLIENT declared this revision. When the SERVER
    // defaulted to it (`transport.defaultProtocolVersion`, the Worker default),
    // the caller never agreed to mirror headers — holding it to SEP-2243 would
    // turn a previously-working call into a 400.
    const strictHeaders = declaresProtocol20260728({
      headers: request.headers as Record<string, unknown> | undefined,
      body,
    });

    const result = validate20260728Request({
      headers: request.headers as Record<string, unknown> | undefined,
      body,
      lookupToolSchema: (toolName) => this.findToolSchema(scope, toolName),
      strictHeaders,
    });

    if (!result.ok) {
      this.log.info('validate: rejected', { code: result.error.code, message: result.error.message });
      this.respond(errorResponse(result.status, result.error, body['id']));
      return;
    }

    this.state.set('version', result.version);
  }

  /**
   * Resolve a tool's input JSON Schema so `x-mcp-header` annotations can be
   * validated against the call arguments.
   *
   * Uses the SAME resolution `tools:call-tool` uses (`getTools(true)` matched on
   * `fullName` or `name`, including hidden tools). Anything looser would let a
   * header-validated call and the call that actually executes disagree about
   * which tool they mean.
   */
  /**
   * Re-enter this request's `FrontMcpContext` for work deferred past the flow.
   *
   * A streamed response is drained by the renderer after the flow has unwound,
   * so anything that runs there has lost the AsyncLocalStorage scope. Capturing
   * the context here and re-entering it keeps every context-dependent API
   * (`notify`, `progress`, `elicit`, provider resolution) behaving identically
   * whether the response was buffered or streamed.
   */
  private buildContextRunner(): (fn: () => Promise<void>) => Promise<void> {
    // Both the context and the storage are resolved NOW, while the stage is
    // still inside the AsyncLocalStorage scope. Reading them lazily from inside
    // the generator would find no active context and silently drop it.
    const context = this.tryGetContext();
    if (!context) return (fn) => fn();

    const storage = this.scope.providers.get(FrontMcpContextStorage);
    return async (fn) => {
      await storage.runWithContext(context, fn);
    };
  }

  private findToolSchema(scope: Scope, toolName: string): Record<string, unknown> | null {
    const match = scope.tools
      .getTools(true)
      .find((entry) => entry.fullName === toolName || entry.metadata.name === toolName);
    return match?.getInputJsonSchema() ?? null;
  }

  @Stage('router')
  async router() {
    const body = (this.rawInput.request.body ?? {}) as Record<string, unknown>;
    const isNotification = body['id'] === undefined || body['id'] === null;

    if (isNotification) {
      this.state.set('requestType', 'notification');
      return;
    }

    this.state.set('requestType', body['method'] === 'subscriptions/listen' ? 'subscriptions' : 'message');
  }

  /**
   * A JSON-RPC notification POST is acknowledged with `202 Accepted` and no
   * body. This revision defines no client→server notifications over HTTP
   * (cancellation is signalled by closing the stream), so nothing is dispatched.
   */
  @Stage('handleNotification', {
    filter: ({ state }) => state.required.requestType === 'notification',
  })
  async handleNotification() {
    this.respond({ kind: 'text', status: 202, body: '', contentType: 'text/plain; charset=utf-8' });
  }

  /**
   * `subscriptions/listen` owns its HTTP response for the life of the
   * subscription, so it is answered with an SSE stream rather than a buffered
   * result. The stream is an `AsyncIterable`, which the Node writer and the Web
   * response renderer both know how to drain — no runtime-specific branch here.
   */
  @Stage('handleSubscriptions', {
    filter: ({ state }) => state.required.requestType === 'subscriptions',
  })
  async handleSubscriptions() {
    const { request, response } = this.rawInput;
    const body = (request.body ?? {}) as Record<string, unknown>;

    // Validate BEFORE committing a response: once the SSE headers are out there
    // is no way to send a JSON-RPC error instead.
    const subscriptionId = requestIdSchema.safeParse(body['id']);
    if (!subscriptionId.success) {
      this.respond(
        errorResponse(400, { code: -32602, message: 'subscriptions/listen requires a string or number id' }, null),
      );
      return;
    }

    const parsedParams = subscriptionParamsSchema.safeParse((body['params'] as Record<string, unknown>) ?? {});
    if (!parsedParams.success) {
      this.respond(
        errorResponse(400, { code: -32602, message: 'Invalid subscriptions/listen params' }, subscriptionId.data),
      );
      return;
    }
    const requested: SubscriptionFilter = parsedParams.data.notifications;

    // Client disconnect is the only way a listen stream ends from the client
    // side in this revision (there is no unsubscribe RPC), so tie the registry
    // listeners' lifetime to the response socket.
    const controller = new AbortController();
    const abort = () => controller.abort();
    (response as unknown as { on?: (event: string, cb: () => void) => void })?.on?.('close', abort);

    const { acknowledged, stream } = createSubscriptionStream({
      scope: this.scope as unknown as Scope,
      subscriptionId: subscriptionId.data,
      requested,
      signal: controller.signal,
    });

    this.log.info('handleSubscriptions: stream opened', {
      subscriptionId: body['id'],
      acknowledged: Object.keys(acknowledged),
    });

    this.respond({
      kind: 'sse',
      status: 200,
      stream,
      contentType: 'text/event-stream',
      disposition: 'inline',
      headers: {
        // Tell reverse proxies not to buffer, or a quiet subscription looks dead.
        'X-Accel-Buffering': 'no',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  @Stage('handleMessage', {
    filter: ({ state }) => state.required.requestType === 'message',
  })
  async handleMessage() {
    const { request } = this.rawInput;
    const body = (request.body ?? {}) as Record<string, unknown>;
    const params = (body['params'] as Record<string, unknown> | undefined) ?? {};
    const meta = (params['_meta'] as Record<string, unknown> | undefined) ?? {};
    const auth = request[ServerRequestTokens.auth] as Authorization | undefined;

    const clientCapabilities =
      (meta[MCP_20260728_META.clientCapabilities] as Record<string, unknown> | undefined) ?? {};

    // `logging/setLevel` is gone: the client opts into log messages per request,
    // and a request that omits `logLevel` MUST receive none. Progress is opted
    // into the same way, via `progressToken`.
    const logLevel =
      typeof meta[MCP_20260728_META.logLevel] === 'string'
        ? (meta[MCP_20260728_META.logLevel] as LoggingLevel)
        : undefined;
    // Only a string or number is a usable progress token. An object or array
    // from a hostile client must not activate the sink, nor be echoed back
    // inside every progress notification.
    const rawProgressToken = meta['progressToken'];
    const progressToken =
      typeof rawProgressToken === 'string' || typeof rawProgressToken === 'number' ? rawProgressToken : undefined;
    const sink = new RequestNotificationSink(logLevel, progressToken);

    const dispatchOptions = {
      scope: this.scope as unknown as Scope,
      body,
      clientCapabilities,
      frontmcpContext: this.tryGetContext(),
      authInfo: auth
        ? {
            token: auth.token,
            clientId: auth.user?.sub,
            // Sessions no longer exist at the protocol level, but the shared
            // handlers key per-request state (memory, credentials) off an id.
            // Derive a request-scoped one so nothing leaks between calls.
            sessionId: auth.session?.id,
            extra: { user: auth.user, sessionId: auth.session?.id },
          }
        : undefined,
      isAnonymous: this.state.required.isAnonymous,
      composeInstructions: () => this.scope.metadata.instructions,
      notificationSink: sink,
      traceContext: extractTraceContext(meta),
    } satisfies Parameters<typeof dispatch20260728>[0];

    // When the client opted into request-scoped notifications AND accepts SSE,
    // the response becomes a stream so log/progress frames can arrive while the
    // work is still running. Otherwise the answer is a single JSON object —
    // both framings are required to be supported by the client.
    if (sink.active && acceptsEventStream(request.headers as Record<string, unknown> | undefined)) {
      this.respond({
        kind: 'sse',
        status: 200,
        stream: streamMessageResponse(dispatchOptions, sink, body['id'], this.buildContextRunner()),
        contentType: 'text/event-stream',
        disposition: 'inline',
        headers: {
          'X-Accel-Buffering': 'no',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
      return;
    }

    const outcome = await dispatch20260728(dispatchOptions);
    sink.close();

    if (outcome.kind === 'error') {
      this.respond(errorResponse(outcome.status, outcome.error, body['id']));
      return;
    }

    this.respond(
      httpRespond.json(
        {
          jsonrpc: '2.0',
          id: body['id'] ?? null,
          result: outcome.result,
        },
        { status: 200 },
      ),
    );
  }

  @Stage('cleanup')
  async cleanup() {
    // Nothing to release: this revision holds no per-request session state.
    // The stage exists so plugins have a symmetric hook point with the other
    // transport flows.
  }
}

/** Re-exported so the router stage of `http:request` can classify without importing the module. */
export { isProtocol20260728Request, MCP_HEADERS, readHeader };
