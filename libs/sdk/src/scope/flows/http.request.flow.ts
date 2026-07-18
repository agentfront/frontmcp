import {
  deriveAuthorizationId,
  ORCHESTRATED_AUTH_ACCESSOR,
  OrchestratedAuthAccessorAdapter,
  OrchestratedAuthorization,
  type OrchestratedProviderState,
  type OrchestratedTokenStore,
} from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import { randomUUID } from '@frontmcp/utils';

import { sessionVerifyOutputSchema } from '../../auth/flows/session.verify.flow';
import {
  authorizeSessionTermination,
  decideIntent,
  decisionSchema,
  Flow,
  FlowBase,
  FlowControl,
  FlowHooksOf,
  httpInputSchema,
  httpOutputSchema,
  httpRespond,
  intentSchema,
  normalizeEntryPrefix,
  normalizeScopeBase,
  ServerRequestTokens,
  toLegacyProtocolFlags,
  type Authorization,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { SessionVerificationFailedError } from '../../errors';
import { type Scope } from '../scope.instance';

const plan = {
  pre: [
    // request tracing
    'traceRequest',
    // rate limiting / concurrency
    'acquireQuota',
    'acquireSemaphore',
    // route request to the correct flow
    'checkAuthorization',
    'router',
  ],
  execute: [
    // Web-fetch (V8-isolate / Cloudflare Worker) MCP handling. Runs FIRST and,
    // in web mode only, responds with a Web `Response` (short-circuiting the
    // Node handle stages below). On the Node/Express path it's a no-op and falls
    // through to the runtime-coupled stages.
    'handleWebFetch',
    'handleLegacySse',
    'handleSse',
    'handleStreamableHttp',
    'handleStatefulHttp',
    'handleStatelessHttp',
    'handleDeleteSession',
  ],
  finalize: [
    // audit/metrics
    'audit',
    'metrics',

    // cleanup
    'releaseSemaphore',
    'releaseQuota',
    'finalize',
  ],
  error: [],
} as const satisfies FlowPlan<string>;

export const httpRequestStateSchema = z.object({
  decision: decisionSchema,
  intent: intentSchema,
  verifyResult: sessionVerifyOutputSchema,
});

const name = 'http:request' as const;
const { Stage } = FlowHooksOf('http:request');

declare global {
  interface ExtendFlows {
    'http:request': FlowRunOptions<
      HttpRequestFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof httpOutputSchema,
      typeof httpRequestStateSchema
    >;
  }
}

@Flow({
  name,
  plan,
  access: 'public',
  inputSchema: httpInputSchema,
  outputSchema: httpOutputSchema,
  middleware: {
    path: '/',
  },
})
export default class HttpRequestFlow extends FlowBase<typeof name> {
  logger = this.scope.logger.child('HttpRequestFlow');
  private requestStartTime = 0;
  private requestId = '';

  static canActivate(request: ServerRequest, scope: ScopeEntry) {
    const requestPath = normalizeEntryPrefix(request.path);
    const prefix = normalizeEntryPrefix(scope.entryPath);
    const scopePath = normalizeScopeBase(scope.routeBase);
    const basePath = `${prefix}${scopePath}`;

    return (
      requestPath === basePath || // Modern transports: /
      requestPath === `${basePath}/sse` || // Legacy SSE: /sse
      requestPath === `${basePath}/message` // Legacy SSE: /message
    );
  }

  @Stage('traceRequest')
  async traceRequest() {
    const { request } = this.rawInput;
    this.requestStartTime = Date.now();

    // Get FrontMcpContext from AsyncLocalStorage (already initialized by FlowInstance.runWithContext)
    const ctx = this.tryGetContext();
    // Use randomUUID() for fallback instead of Math.random() to avoid collisions under load
    this.requestId = ctx?.requestId ?? `req-${randomUUID()}`;

    // Extract request details for logging
    const headers = request.headers ?? {};
    const body = request.body as Record<string, unknown> | undefined;
    const userAgent = headers['user-agent'] as string | undefined;
    const contentType = headers['content-type'] as string | undefined;
    const accept = headers['accept'] as string | undefined;
    // Use sessionId from context (which generates unique anon IDs) or header
    // 'no-session' is a logging fallback only, not used for SESSION providers
    const sessionId = ctx?.sessionId ?? (headers['mcp-session-id'] as string) ?? 'no-session';

    this.logger.info(`[${this.requestId}] ▶ ${request.method} ${request.path}`, {
      requestId: this.requestId,
      traceId: ctx?.traceContext.traceId?.slice(0, 16),
      method: request.method,
      path: request.path,
      userAgent: userAgent?.slice(0, 50),
      sessionId: sessionId?.slice(0, 20),
      contentType,
      accept,
      hasBody: !!request.body,
      bodyMethod: body?.['method'],
    });

    // Log sanitized headers for debugging connection issues
    const sanitizedHeaders = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => {
        // Redact clearly sensitive headers
        if (/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(key)) {
          return [key, '[REDACTED]'];
        }
        // Truncate session identifiers instead of logging full values
        if (key === 'mcp-session-id') {
          return [key, String(value).slice(0, 8) + '...'];
        }
        return [key, value];
      }),
    );
    this.logger.debug(`[${this.requestId}] HEADERS`, { headers: sanitizedHeaders });
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    const manager = this.scope.rateLimitManager;
    if (!manager?.config?.global) return;

    const context = this.tryGetContext();
    const partitionCtx = context
      ? {
          sessionId: context.sessionId,
          clientIp: context.metadata?.clientIp,
          userId: context.authInfo?.clientId as string | undefined,
        }
      : undefined;

    const result = await manager.checkGlobalRateLimit(partitionCtx);
    if (!result.allowed) {
      const retryAfter = Math.ceil((result.retryAfterMs ?? 60_000) / 1000);
      this.respond(
        httpRespond.json(
          {
            jsonrpc: '2.0',
            error: { code: -32029, message: `Rate limit exceeded. Retry after ${retryAfter} seconds` },
          },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        ),
      );
      return;
    }
  }

  @Stage('checkAuthorization')
  async checkAuthorization() {
    const { request } = this.rawInput;
    this.logger.verbose(`[${this.requestId}] checkAuthorization: verifying session`);

    try {
      const result = await this.scope.runFlow('session:verify', { request });
      if (!result) {
        this.logger.error(`[${this.requestId}] failed to verify session`);
        throw new SessionVerificationFailedError();
      }
      this.state.set({
        verifyResult: result,
      });

      // Update FrontMcpContext with verified auth info if available
      // This allows all subsequent stages to access the auth info via context
      if (result.kind === 'authorized' && result.authorization) {
        const ctx = this.tryGetContext();
        if (ctx) {
          // Build AuthInfo from the authorization object
          // AuthInfo is the MCP SDK's auth type with token, clientId, scopes, etc.
          const { token, user, session } = result.authorization;

          ctx.updateAuthInfo({
            token,
            clientId: user.sub,
            // Populate scopes from the verified token's `scope` claim (space-
            // delimited per RFC 6749 §3.3) instead of hardcoding `[]`, so any
            // consumer that authorizes on `authInfo.scopes` sees the real grant.
            scopes: typeof user['scope'] === 'string' ? user['scope'].split(/\s+/).filter(Boolean) : [],
            // JWT exp is in seconds, SDK uses milliseconds throughout (e.g., Date.now())
            expiresAt: user.exp ? user.exp * 1000 : undefined,
            extra: {
              user,
              sessionId: session?.id,
              sessionPayload: session?.payload,
            },
          });

          // Bind `this.orchestration` for tools in orchestrated (local/remote)
          // mode so `this.orchestration.getToken(id)` resolves a live upstream
          // token instead of throwing the Null-accessor error.
          await this.bindOrchestrationAccessor(ctx, token, user);
        }
      }
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'checkAuthorization');
      }
      throw error;
    }
  }

  /**
   * Build a live {@link OrchestratedAuthAccessorAdapter} for the verified request
   * and register it under {@link ORCHESTRATED_AUTH_ACCESSOR} so tools can read
   * upstream provider tokens via `this.orchestration.getToken(id)`.
   *
   * `session:verify` returns a lightweight authorization (`{ token, user, … }`)
   * rather than a full OrchestratedAuthorization, so we reconstruct one here from
   * the verified JWT + the primary auth's encrypted token store (the same store
   * the federated provider-callback flow wrote upstream tokens into, keyed by
   * `deriveAuthorizationId(token)`). No-op unless the scope is in orchestrated
   * mode with a token store and a non-empty bearer token — so public/transparent
   * and anonymous requests are unaffected.
   *
   * Security: tokens stay server-side and AES-GCM-encrypted at rest; only the
   * non-PII provider ids are read here to project the authorization.
   */
  private async bindOrchestrationAccessor(
    ctx: { setContextToken: (token: unknown, instance: unknown) => void },
    token: string,
    user: { sub?: string; name?: string; email?: string; picture?: string; exp?: number },
  ): Promise<void> {
    const auth = this.scope.auth as
      | { orchestratedTokenStore?: OrchestratedTokenStore; options?: { mode?: string } }
      | undefined;
    // Only local/remote (orchestrated) modes carry an upstream token store.
    const mode = auth?.options?.mode;
    const isOrchestrated = mode === 'local' || mode === 'remote';
    if (!token || !auth?.orchestratedTokenStore || !isOrchestrated) {
      return;
    }

    const tokenStore = auth.orchestratedTokenStore;

    // Load the providers the user linked (written by the federated flow under
    // the same authorization id). Failure to read must not break the request.
    let providers: Record<string, OrchestratedProviderState> | undefined;
    try {
      const authorizationId = deriveAuthorizationId(token);
      const providerIds = await tokenStore.getProviderIds(authorizationId);
      providers = Object.fromEntries(providerIds.map((id) => [id, { id }]));
    } catch (err) {
      this.logger.warn(`[${this.requestId}] failed to load orchestrated providers: ${String(err)}`);
    }

    const authorization = OrchestratedAuthorization.create({
      token,
      user: { sub: user.sub ?? 'unknown', name: user.name, email: user.email, picture: user.picture },
      expiresAt: user.exp ? user.exp * 1000 : undefined,
      tokenStore,
      providers,
    });

    ctx.setContextToken(ORCHESTRATED_AUTH_ACCESSOR, new OrchestratedAuthAccessorAdapter(authorization));
  }

  @Stage('router')
  async router() {
    try {
      const { request } = this.rawInput;
      this.logger.verbose(`[${this.requestId}] router: check request decision`);

      // Use transport config from scope metadata (top-level transport config only)
      const transportConfig = this.scope.metadata.transport;
      if (!transportConfig) {
        this.logger.error(`[${this.requestId}] transport config not found in scope metadata`);
        this.respond(
          httpRespond.json(
            { error: 'Internal Server Error', message: 'Transport configuration missing' },
            { status: 500 },
          ),
        );
        return;
      }
      // Convert protocol preset to legacy boolean flags for decideIntent
      const legacyFlags = toLegacyProtocolFlags(transportConfig.protocol);
      this.logger.debug(`[${this.requestId}] transport config`, {
        protocol: transportConfig.protocol,
        enableLegacySSE: legacyFlags.enableLegacySSE,
        enableStreamableHttp: legacyFlags.enableStreamableHttp,
        path: request.path,
        accept: request.headers?.['accept'],
      });
      const decision = decideIntent(request, { ...legacyFlags, tolerateMissingAccept: true });

      // Web mode (V8-isolate / worker): every request is handled independently by
      // the WebStandard transport — there is no session handshake. If intent
      // decoding came back 'unknown' only because no session was presented (the
      // common case under the session-oriented `legacy`/`modern` presets), treat
      // it as stateless so it still routes to `handleWebFetch`. Auth is unaffected
      // — the authorized/unauthorized/forbidden branches below still run, so a
      // missing/invalid token on a real MCP request still yields 401/403.
      const isWebMode = !!(request as unknown as Record<PropertyKey, unknown>)[ServerRequestTokens.webRequest];
      if (isWebMode && decision.intent === 'unknown') {
        decision.intent = 'stateless-http';
      }

      this.logger.debug(`[${this.requestId}] decision result`, {
        intent: decision.intent,
        reasons: decision.reasons,
        debug: decision.debug,
      });

      // #380 — Detect JSON-RPC POST/GET requests without a session/initialize
      // and surface a structured JSON-RPC error envelope instead of letting
      // them fall through to Express's default 404 (which returns HTML and
      // breaks every MCP client SDK that parses the response as JSON).
      // The body shape check (`jsonrpc + method`) is sufficient — only
      // genuine JSON-RPC requests get the error envelope; everything else
      // (favicon, health probes, custom routes) still falls through.
      const routerBody = request.body as Record<string, unknown> | undefined;
      const isJsonRpcRequest =
        request.method.toUpperCase() !== 'DELETE' &&
        routerBody &&
        typeof routerBody === 'object' &&
        routerBody['jsonrpc'] === '2.0' &&
        typeof routerBody['method'] === 'string' &&
        routerBody['method'] !== 'initialize';
      const respondNoSession = (): never => {
        const requestId = (routerBody?.['id'] as string | number | null | undefined) ?? null;
        // `this.respond(...)` always throws a FlowControl envelope; we cast the
        // call to `never` rather than emitting an unreachable Error so the
        // dependency on FlowControl semantics is explicit.
        return this.respond({
          kind: 'json',
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: {
            jsonrpc: '2.0',
            id: requestId,
            error: {
              code: -32600,
              message: 'Session not initialized — send `initialize` first',
              data: { transport: 'streamable-http', expected: 'initialize' },
            },
          },
        }) as never;
      };

      // Handle DELETE method immediately - it's for session termination
      // regardless of what protocol the session was created with
      if (request.method.toUpperCase() === 'DELETE') {
        this.logger.verbose(`[${this.requestId}] DELETE request, using decision intent: ${decision.intent}`);
        if (decision.intent === 'unknown') {
          // DELETE without session ID - forward to next middleware
          // to allow custom DELETE handlers by developers
          this.logger.verbose(`[${this.requestId}] DELETE with unknown intent, forwarding to next middleware`);
          this.next();
          return;
        }

        // SECURITY: session termination MUST be authenticated and scoped to the
        // caller's OWN session. Previously the DELETE branch returned here
        // before the authorization result was ever consulted, so an
        // unauthenticated attacker who knew a session id could terminate ANY
        // session (cross-session DoS). Delegate the decision to the pure,
        // unit-tested `authorizeSessionTermination`.
        const deleteVerify = this.state.required.verifyResult;
        const requestedSessionId =
          (request[ServerRequestTokens.sessionId] as string | undefined) ??
          (request.headers['mcp-session-id'] as string | undefined) ??
          (request.query?.['sessionId'] as string | undefined);
        const deleteAuthz = authorizeSessionTermination(deleteVerify, requestedSessionId);
        if (deleteAuthz.kind === 'unauthorized') {
          this.logger.warn(`[${this.requestId}] DELETE session denied: request is not authenticated`);
          this.respond(
            httpRespond.unauthorized({
              headers: {
                'WWW-Authenticate': (deleteVerify as { prmMetadataHeader?: string }).prmMetadataHeader ?? 'Bearer',
              },
            }),
          );
          return;
        }
        if (deleteAuthz.kind === 'forbidden') {
          this.logger.warn(`[${this.requestId}] DELETE session denied: caller does not own the requested session id`);
          // Never terminate (or confirm the existence of) another caller's session.
          this.respond(httpRespond.notFound('Session not found'));
          return;
        }
        // Bind the VERIFIED authorization + session id so handleDeleteSession
        // terminates the caller's own session and can clean up its transport.
        request[ServerRequestTokens.auth] = (deleteVerify as { authorization: unknown }).authorization;
        request[ServerRequestTokens.sessionId] = deleteAuthz.sessionId;
        this.state.set('intent', decision.intent);
        return;
      }

      const { verifyResult } = this.state.required;
      if (verifyResult.kind === 'authorized') {
        const { authorization } = verifyResult;
        request[ServerRequestTokens.auth] = authorization;

        // Update FrontMcpContext session metadata (auth info already set in checkAuthorization)
        if (authorization.session?.payload) {
          const ctx = this.tryGetContext();
          if (ctx) {
            ctx.updateSessionMetadata(authorization.session.payload);
          }
        }

        if (authorization.session) {
          const sessionId = authorization.session.id;
          request[ServerRequestTokens.sessionId] = sessionId;

          // Check if the session has been terminated (via DELETE).
          // Per MCP spec §Session Management:
          //   - Server MUST respond with 404 to requests containing a terminated session ID.
          //   - Client MUST start a new session by sending InitializeRequest without session ID.
          // EXCEPTION: initialize with a valid signed session ID re-initializes under the
          // same session ID. The session is unmarked from terminated so subsequent requests
          // (notifications/initialized, tools/list, etc.) work normally.
          if (this.scope.notifications.isSessionTerminated(sessionId)) {
            const body = request.body as { method?: string } | undefined;
            if (body?.method === 'initialize') {
              this.logger.info(
                `[${this.requestId}] Initialize with terminated session ${sessionId.slice(0, 20)}... - re-initializing`,
              );
              // Remove from terminated set — session is being re-initialized
              this.scope.notifications.unmarkTerminated(sessionId);
              // Signal to onInitialize that this is a re-initialization of a terminated session
              request[ServerRequestTokens.reinitialize] = true;
              // Keep session refs intact — parseInput will reuse the session ID
              // Fall through to decision-based routing (don't return 404)
            } else {
              this.logger.warn(`[${this.requestId}] Request to terminated session: ${sessionId.slice(0, 20)}...`);
              this.respond(httpRespond.notFound('Session not found'));
              return;
            }
          }

          // Safely access payload.protocol with null check
          const protocol = authorization.session?.payload?.protocol;
          if (protocol) {
            this.logger.info(`[${this.requestId}] decision from session: ${protocol}`);
            this.state.set('intent', protocol);
            return;
          }
        }

        if (decision.intent === 'unknown') {
          if (isJsonRpcRequest) {
            this.logger.info(
              `[${this.requestId}] no session, JSON-RPC body present — responding with structured error (#380)`,
            );
            respondNoSession();
          }
          // continue to other middleware
          // with authentication (public/authorized routes)
          this.logger.verbose(`[${this.requestId}] decision is unknown, continue to next http middleware`);
          this.next();
          return; // Explicit return for clarity (this.next() throws FlowControl)
        }

        // register decision intent to state
        // and move to next stage
        this.logger.verbose(`[${this.requestId}] decision is request info: ${decision.intent}`);
        this.state.set('intent', decision.intent);
      } else if (verifyResult.kind === 'forbidden') {
        if (decision.intent === 'unknown') {
          if (isJsonRpcRequest) {
            respondNoSession();
          }
          this.logger.verbose(
            `[${this.requestId}] forbidden with unknown intent, continue to other public http middleware`,
          );
          this.next();
          return;
        }
        // Token is valid but has insufficient scopes (RFC 6750 §3.1 → 403)
        this.logger.warn(`[${this.requestId}] forbidden: insufficient scope`);
        this.respond(
          httpRespond.forbidden({
            headers: {
              'WWW-Authenticate': verifyResult.prmMetadataHeader,
            },
          }),
        );
      } else {
        this.logger.verbose(`[${this.requestId}] not authorized request, check decision intent: ${decision.intent}`);
        if (decision.intent === 'unknown') {
          if (isJsonRpcRequest) {
            respondNoSession();
          }
          this.logger.verbose(`[${this.requestId}] decision is unknown, continue to other public http middleware`);
          // continue to other middleware
          // without authentication (public routes)
          this.next();
          return; // Explicit return for clarity (this.next() throws FlowControl)
        }

        this.logger.warn(`[${this.requestId}] decision is ${decision.intent}, but not authorized, respond with 401`);
        // if the decision is specific mcp transport and no auth
        // then respond with 401
        this.respond(
          httpRespond.unauthorized({
            headers: {
              'WWW-Authenticate': verifyResult.prmMetadataHeader,
            },
          }),
        );
      }
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'router');
      }
      throw error;
    }
  }

  /**
   * Web-fetch (V8-isolate) MCP execute stage. The worker carries its native Web
   * `Request` on the normalized `ServerRequest` under {@link
   * ServerRequestTokens.webRequest}; its presence is the web-mode signal. When
   * present, this stage runs the MCP request through the SDK's
   * `WebStandardStreamableHTTPServerTransport` (via {@link runWebStandardMcp})
   * and responds with the resulting Web `Response` — so the worker runs the SAME
   * `http:request` flow (auth, quota, router, audit, metrics + hooks all apply)
   * and only the transport rendering differs per runtime.
   *
   * On the Node/Express path there is no `webRequest`, so this is a no-op and the
   * request falls through to the Node-`ServerResponse`-coupled handle stages.
   * Auth has already been enforced by `router` (a 401/403 short-circuits before
   * execute), and the verified authorization is read from the request token.
   */
  @Stage('handleWebFetch')
  async handleWebFetch() {
    const { request } = this.rawInput;
    const req = request as unknown as Record<PropertyKey, unknown>;
    const webRequest = req[ServerRequestTokens.webRequest] as Request | undefined;
    if (!webRequest) return; // Node/Express path — defer to the Node handle stages.

    try {
      const webCtx = req[ServerRequestTokens.webCtx] as { waitUntil?(promise: Promise<unknown>): void } | undefined;

      const { runWebStandardMcp } = await import('../../transport/web-standard-mcp.js');
      const { buildScopedServerOptions } = await import('../../transport/build-scoped-server-options.js');
      const { expandProtocolConfig } = await import('../../common/types/options/transport/schema.js');

      // `FlowBase` types `this.scope` as the narrow `ScopeEntry`, but the concrete
      // runtime value is the full `Scope` the MCP wiring helpers need.
      const scope = this.scope as unknown as Scope;

      // SSE streaming on POST mirrors the transport protocol: stream when
      // Streamable HTTP is on and JSON-only buffering is off.
      const proto = expandProtocolConfig(scope.metadata.transport?.protocol);
      const sse = proto.streamable && !proto.json;

      // The verified authorization the `router` stage attached. Project it to the
      // MCP `AuthInfo` shape the handlers expect (same mapping as checkAuthorization).
      const authorization = req[ServerRequestTokens.auth] as Authorization | undefined;
      const authInfo = authorization
        ? {
            token: authorization.token,
            clientId: authorization.user?.sub,
            // Same scope parsing as the Node path (checkAuthorization) so
            // scope-aware handlers behave identically on the web transport. The
            // `scope` claim is present at runtime but not on the `UserClaim`
            // type, so read it through a narrow cast.
            scopes: ((s) => (typeof s === 'string' ? s.split(/\s+/).filter(Boolean) : ([] as string[])))(
              (authorization.user as { scope?: unknown } | undefined)?.scope,
            ),
            expiresAt: authorization.user?.exp ? authorization.user.exp * 1000 : undefined,
            extra: {
              user: authorization.user,
              sessionId: authorization.session?.id,
              sessionPayload: authorization.session?.payload,
            },
          }
        : undefined;

      // Stateful sessions: a Durable Object threads its persistent server +
      // transport here so the GET notification stream stays open across requests.
      const persistent = req[ServerRequestTokens.webTransport] as
        | Parameters<typeof runWebStandardMcp>[2]['persistent']
        | undefined;

      const response = await runWebStandardMcp(scope, webRequest, {
        serverOptions: buildScopedServerOptions(scope),
        authInfo,
        sse,
        ctx: webCtx,
        persistent,
      });
      this.respond(httpRespond.webResponse(response));
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'handleWebFetch');
      }
      throw error;
    }
  }

  @Stage('handleLegacySse', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'legacy-sse',
  })
  async handleLegacySse() {
    try {
      const response = await this.scope.runFlow('handle:legacy-sse', this.rawInput);
      if (response) {
        this.respond(response);
      }
      this.handled();
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'handleLegacySse');
      }
      throw error;
    }
  }

  @Stage('handleSse', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'sse',
  })
  async handleSse() {
    try {
      const response = await this.scope.runFlow('handle:streamable-http', this.rawInput);
      if (response) {
        this.respond(response);
      }
      this.next();
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'handleSse');
      }
      throw error;
    }
  }

  @Stage('handleStreamableHttp', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'streamable-http',
  })
  async handleStreamableHttp() {
    try {
      const response = await this.scope.runFlow('handle:streamable-http', this.rawInput);
      if (response) {
        this.respond(response);
      }
      this.next();
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'handleStreamableHttp');
      }
      throw error;
    }
  }

  @Stage('handleStatefulHttp', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'stateful-http',
  })
  async handleStatefulHttp() {
    try {
      const response = await this.scope.runFlow('handle:streamable-http', this.rawInput);
      if (response) {
        this.respond(response);
      }
      this.next();
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'handleStatefulHttp');
      }
      throw error;
    }
  }

  @Stage('handleStatelessHttp', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'stateless-http',
  })
  async handleStatelessHttp() {
    try {
      const response = await this.scope.runFlow('handle:stateless-http', this.rawInput);
      if (response) {
        this.respond(response);
      }
      this.handled();
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'handleStatelessHttp');
      }
      throw error;
    }
  }

  @Stage('handleDeleteSession', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'delete-session',
  })
  async handleDeleteSession() {
    try {
      const { request } = this.rawInput;
      // Headers are normalized to lowercase by the adapter
      const sessionId = request[ServerRequestTokens.sessionId] ?? request.headers['mcp-session-id'];

      if (!sessionId || typeof sessionId !== 'string') {
        this.logger.warn(`[${this.requestId}] DELETE request without valid session ID`);
        this.respond(httpRespond.rpcError('No valid session ID provided'));
        return;
      }

      this.logger.info(`[${this.requestId}] DELETE session: ${sessionId}`);

      // Terminate the session - this unregisters the server AND adds to terminated set.
      // This prevents future non-initialize requests with this session ID from being accepted.
      // After re-initialization, the server may not be in the notification service's map
      // (resetForReinitialization doesn't re-register it), so wasRegistered can be false
      // for a session that has a live transport. We always proceed with transport cleanup.
      this.scope.notifications.terminateSession(sessionId);

      // Destroy the transport to free resources and clean up Redis.
      const authorization = request[ServerRequestTokens.auth] as Authorization | undefined;
      if (authorization?.token) {
        const transportService = this.scope.transportService;
        if (transportService) {
          for (const protocol of ['streamable-http', 'sse'] as const) {
            try {
              await transportService.destroyTransporter(protocol, authorization.token, sessionId);
            } catch {
              // Transport may already be evicted or not found — non-critical
            }
          }
        }
      }

      this.logger.info(`[${this.requestId}] Session terminated: ${sessionId}`);
      this.respond(httpRespond.noContent());
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        this.logError(error, 'handleDeleteSession');
      }
      throw error;
    }
  }

  @Stage('finalize')
  async finalize() {
    const { request } = this.rawInput;
    const duration = Date.now() - this.requestStartTime;
    const intent = this.state.get('intent') ?? 'unknown';

    this.logger.info(`[${this.requestId}] ◀ ${request.method} ${request.path} completed in ${duration}ms`, {
      requestId: this.requestId,
      method: request.method,
      path: request.path,
      duration,
      intent,
    });
  }

  /**
   * Log an error that occurred during request processing.
   * Called from stage handlers that catch errors.
   */
  private logError(error: unknown, context?: string) {
    const { request } = this.rawInput;
    const duration = Date.now() - this.requestStartTime;

    // Extract error details - handle various error shapes
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorStack = error instanceof Error ? error.stack : undefined;
    const body = request.body as Record<string, unknown> | undefined;

    // For errors with empty messages, try to extract more info
    const errorCode = (error as { code?: string | number })?.code;
    const errorCause = (error as { cause?: unknown })?.cause;

    // Log comprehensive error info including stack trace
    this.logger.error(
      `[${this.requestId}] ✖ ${request.method} ${request.path} failed${
        context ? ` in ${context}` : ''
      } after ${duration}ms: ${errorMessage || '(no message)'}`,
      {
        requestId: this.requestId,
        method: request.method,
        path: request.path,
        duration,
        context,
        error: {
          name: errorName,
          message: errorMessage || '(no message)',
          code: errorCode,
          cause: errorCause instanceof Error ? errorCause.message : errorCause,
          stack: errorStack,
        },
        request: {
          userAgent: (request.headers?.['user-agent'] as string)?.slice(0, 50),
          sessionId: (request.headers?.['mcp-session-id'] as string)?.slice(0, 20),
          contentType: request.headers?.['content-type'],
          bodyMethod: body?.['method'],
          bodyId: body?.['id'],
        },
        state: {
          intent: this.state.get('intent'),
          hasVerifyResult: !!this.state.get('verifyResult'),
        },
      },
    );
  }
}
