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
  createDeferredServerBuild,
  runHttpRequestFlowWeb,
  startupFailureResponse,
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

/** Minimal structural view of a Durable Object's `state.storage`. */
interface DurableObjectStorageLike {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

/** Header the worker stamps so the DO binds its transport to the routed session id. */
const SESSION_ID_HEADER = 'x-frontmcp-session-id';

/** Storage key of the caller that owns the session (see the `http:request` flow's owner check). */
const SESSION_OWNER_KEY = 'frontmcp:session-owner';

/** A stored owner: a caller key, `null` for a caller with no identity, `undefined` for none yet. */
function storedOwner(value: unknown): string | null | undefined {
  return typeof value === 'string' || value === null ? value : undefined;
}

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

/** Log a failed session build once per attempt: the request it refuses carries only a code. */
function logStartFailure(error: unknown): void {
  console.error(
    '[frontmcp/edge] The session Durable Object failed to start; requests are refused until a retry succeeds.',
    error,
  );
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
    // Built once per instance and shared by concurrent first requests. A failed build is kept and
    // refuses requests until its retry delay passes (1 s, doubling up to 60 s), then the next
    // request tries again, so one transient init error doesn't brick this instance.
    readonly #scope = createDeferredServerBuild((env: unknown) => buildScope(env), { onFailure: logStartFailure });
    readonly #pair = createDeferredServerBuild(
      ({ scope, sessionId }: { scope: Scope; sessionId: string }) => this.#buildPair(scope, sessionId),
      { onFailure: logStartFailure },
    );
    readonly #doEnv: unknown;
    readonly #storage: DurableObjectStorageLike | undefined;

    constructor(state: unknown, env: unknown) {
      this.#doEnv = env;
      const storage = (state as { storage?: Partial<DurableObjectStorageLike> } | undefined)?.storage;
      this.#storage =
        storage && typeof storage.get === 'function' && typeof storage.put === 'function'
          ? (storage as DurableObjectStorageLike)
          : undefined;
    }

    /**
     * The session's persistent server + transport, built once (concurrent first requests share it).
     * Its owner is loaded from storage first, so an instance rebuilt after eviction keeps the caller
     * that opened the session; the `http:request` flow decides, the storage only remembers.
     */
    async #buildPair(scope: Scope, sessionId: string): Promise<WebStandardMcpPair> {
      const storage = this.#storage;
      const owner = storage
        ? {
            initial: storedOwner(await storage.get(SESSION_OWNER_KEY)),
            save: (callerKey: string | null) => storage.put(SESSION_OWNER_KEY, callerKey),
          }
        : undefined;
      return buildPersistentWebStandardMcp(scope, { sessionId, owner });
    }

    async fetch(request: Request): Promise<Response> {
      bridgeEnv(this.#doEnv);
      const sessionId = request.headers.get(SESSION_ID_HEADER) ?? request.headers.get('mcp-session-id') ?? randomUUID();

      // Build the scope, then the session's persistent server + transport, once; reuse them for
      // every subsequent request so the GET notification stream survives. A failed build is
      // answered, never thrown to the platform: a configuration fault as 500
      // `server_misconfigured`, anything else as 503 `server_unavailable` with `Retry-After`.
      let scope: Scope;
      let pair: WebStandardMcpPair;
      try {
        scope = await this.#scope.get(this.#doEnv);
        pair = await this.#pair.get({ scope, sessionId });
      } catch (error) {
        return startupFailureResponse(error, Math.max(this.#scope.retryAfterSeconds(), this.#pair.retryAfterSeconds()));
      }

      // #536 — the DO's own bindings reach tools through the same request token
      // the stateless path uses.
      const response = await runHttpRequestFlowWeb(scope, request, { env: this.#doEnv, persistent: pair });
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
