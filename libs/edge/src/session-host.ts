/**
 * Cloudflare **Durable Object** session host for stateful MCP on Workers.
 *
 * The stateless web path can't support the Streamable HTTP standalone GET
 * notification stream: each request gets a fresh isolate/transport, so a
 * `tools/call`'s notifications have no path back to the client's open GET
 * stream. A Durable Object fixes this — one instance per `Mcp-Session-Id` holds
 * a **persistent** `McpServer` + session-bound transport, so the GET stream
 * stays open across requests and notifications reach it.
 *
 * It runs the SAME `http:request` flow as the stateless path (auth, quota,
 * router, audit, metrics + hooks) — only the transport persists. The worker
 * routes a request to its session DO; the DO runs the flow with its persistent
 * transport threaded in.
 */
import {
  buildPersistentWebStandardMcp,
  runHttpRequestFlowWeb,
  type WebFetchSessionRouter,
  type WebStandardMcpPair,
} from '@frontmcp/sdk';
import { randomUUID } from '@frontmcp/utils';

/** The FrontMCP scope type, derived to avoid widening the SDK's public surface. */
type Scope = Parameters<typeof runHttpRequestFlowWeb>[0];

/** Minimal structural view of a Cloudflare `DurableObjectNamespace`. */
interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

/** Header the worker stamps so the DO binds its transport to the routed session id. */
const SESSION_ID_HEADER = 'x-frontmcp-session-id';

/**
 * Build the {@link WebFetchSessionRouter} that forwards an MCP request to its
 * per-session Durable Object — addressed by `Mcp-Session-Id`, minting a fresh id
 * for new sessions (`initialize`). Returns `undefined` (→ stateless fallback)
 * when the DO binding isn't present or for CORS preflight (handled by the adapter).
 */
export function createEdgeSessionRouter(bindingName: string): WebFetchSessionRouter {
  return async (request, env) => {
    const ns = (env as Record<string, unknown> | undefined)?.[bindingName] as DurableObjectNamespaceLike | undefined;
    if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') return undefined;
    if (request.method.toUpperCase() === 'OPTIONS') return undefined;

    // Subsequent requests carry Mcp-Session-Id; initialize has none → mint one.
    // `idFromName(sessionId)` is deterministic, so every request for a session
    // reaches the same DO instance.
    const sessionId = request.headers.get('mcp-session-id') ?? randomUUID();
    const headers = new Headers(request.headers);
    headers.set(SESSION_ID_HEADER, sessionId);
    const stub = ns.get(ns.idFromName(sessionId));
    return stub.fetch(new Request(request, { headers }));
  };
}

/**
 * Build the Durable Object class for stateful MCP sessions. `buildScope(env)`
 * builds the FrontMCP scope inside the DO's isolate; `bridgeEnv(env)` mirrors the
 * Worker `env` into `process.env` (so `session:verify` sees `MCP_SESSION_SECRET`,
 * etc.). Each instance lazily builds its scope + a persistent transport once,
 * then handles every request for its session on them.
 */
export function createEdgeSessionDurableObject(
  buildScope: (env: unknown) => Promise<Scope>,
  bridgeEnv: (env: unknown) => void,
) {
  // ES `#private` fields (not TS `private`) — an exported anonymous class type
  // may not carry `private`/`protected` members (TS4094).
  return class FrontMcpSessionDurableObject {
    #scopePromise?: Promise<Scope>;
    #pair?: WebStandardMcpPair;
    readonly #doEnv: unknown;

    constructor(_state: unknown, env: unknown) {
      this.#doEnv = env;
    }

    async fetch(request: Request): Promise<Response> {
      bridgeEnv(this.#doEnv);
      const sessionId =
        request.headers.get(SESSION_ID_HEADER) ?? request.headers.get('mcp-session-id') ?? randomUUID();

      const scope = await (this.#scopePromise ??= buildScope(this.#doEnv));
      // Build the session's persistent server + transport once; reuse it for
      // every subsequent request so the GET notification stream survives.
      if (!this.#pair) {
        this.#pair = await buildPersistentWebStandardMcp(scope, { sessionId });
      }

      const response = await runHttpRequestFlowWeb(scope, request, { persistent: this.#pair });
      return (
        response ??
        new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })
      );
    }
  };
}
