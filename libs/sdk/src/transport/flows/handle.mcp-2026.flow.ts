/**
 * `handle:mcp-2026` — the request pipeline for MCP protocol revision 2026-07-28.
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
import { MCP_2026_META, type SubscriptionFilter } from '@frontmcp/protocol';

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
import { type Scope } from '../../scope';
import {
  createSubscriptionStream,
  dispatch2026,
  isProtocol2026Request,
  MCP_HEADERS,
  readHeader,
  validate2026Request,
  type JsonRpcErrorPayload,
} from '../mcp-2026';

export const plan = {
  pre: ['parseInput', 'validate', 'router'],
  execute: ['handleNotification', 'handleSubscriptions', 'handleMessage'],
  post: [],
  finalize: ['cleanup'],
} as const satisfies FlowPlan<string>;

export const stateSchema = z.object({
  /** Negotiated protocol version for this request. */
  version: z.string().optional(),
  requestType: z.enum(['notification', 'subscriptions', 'message']).optional(),
  isAnonymous: z.boolean().default(true),
});

const name = 'handle:mcp-2026' as const;
const { Stage } = FlowHooksOf(name);

declare global {
  interface ExtendFlows {
    'handle:mcp-2026': FlowRunOptions<
      HandleMcp2026Flow,
      typeof plan,
      typeof httpInputSchema,
      typeof httpOutputSchema,
      typeof stateSchema
    >;
  }
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
export default class HandleMcp2026Flow extends FlowBase<typeof name> {
  name = name;

  private get log() {
    return this.scope.logger.child('HandleMcp2026Flow');
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

    const result = validate2026Request({
      headers: request.headers as Record<string, unknown> | undefined,
      body,
      lookupToolSchema: (toolName) => this.findToolSchema(scope, toolName),
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
    const params = (body['params'] as Record<string, unknown> | undefined) ?? {};
    const requested = (params['notifications'] as SubscriptionFilter | undefined) ?? {};

    // Client disconnect is the only way a listen stream ends from the client
    // side in this revision (there is no unsubscribe RPC), so tie the registry
    // listeners' lifetime to the response socket.
    const controller = new AbortController();
    const abort = () => controller.abort();
    (response as unknown as { on?: (event: string, cb: () => void) => void })?.on?.('close', abort);

    const { acknowledged, stream } = createSubscriptionStream({
      scope: this.scope as unknown as Scope,
      subscriptionId: body['id'] as string | number,
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

    const clientCapabilities = (meta[MCP_2026_META.clientCapabilities] as Record<string, unknown> | undefined) ?? {};

    const outcome = await dispatch2026({
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
    });

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
export { isProtocol2026Request, MCP_HEADERS, readHeader };
