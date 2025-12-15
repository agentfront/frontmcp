import {
  Flow,
  httpInputSchema,
  FlowRunOptions,
  httpOutputSchema,
  FlowPlan,
  FlowBase,
  ScopeEntry,
  FlowHooksOf,
  ServerRequest,
  ServerRequestTokens,
  httpRespond,
  decideIntent,
  decisionSchema,
  intentSchema,
  normalizeEntryPrefix,
  normalizeScopeBase,
  FlowControl,
} from '../../common';
import { z } from 'zod';
import { sessionVerifyOutputSchema } from '../../auth/flows/session.verify.flow';
import { randomUUID } from 'node:crypto';

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

  @Stage('checkAuthorization')
  async checkAuthorization() {
    const { request } = this.rawInput;
    this.logger.verbose(`[${this.requestId}] checkAuthorization: verifying session`);

    try {
      const result = await this.scope.runFlow('session:verify', { request });
      if (!result) {
        this.logger.error(`[${this.requestId}] failed to verify session`);
        throw new Error('Session verification failed');
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
            scopes: [],
            // JWT exp is in seconds, SDK uses milliseconds throughout (e.g., Date.now())
            expiresAt: user.exp ? user.exp * 1000 : undefined,
            extra: {
              user,
              sessionId: session?.id,
              sessionPayload: session?.payload,
            },
          });
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

  @Stage('router')
  async router() {
    try {
      const { request } = this.rawInput;
      this.logger.verbose(`[${this.requestId}] router: check request decision`);

      // Use transport config directly from auth (already parsed with defaults by Zod)
      const transport = this.scope.auth.transport;
      const decision = decideIntent(request, { ...transport, tolerateMissingAccept: true });

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

          // Check if the session has been terminated (via DELETE)
          // Per MCP spec, requests to terminated sessions should return 404
          if (this.scope.notifications.isSessionTerminated(sessionId)) {
            this.logger.warn(`[${this.requestId}] Request to terminated session: ${sessionId.slice(0, 20)}...`);
            this.respond(httpRespond.notFound('Session not found'));
            return;
          }

          // Safely access payload.protocol with null check
          const protocol = authorization.session.payload?.protocol;
          if (protocol) {
            this.logger.info(`[${this.requestId}] decision from session: ${protocol}`);
            this.state.set('intent', protocol);
            return;
          }
        }

        if (decision.intent === 'unknown') {
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
      } else {
        this.logger.verbose(`[${this.requestId}] not authorized request, check decision intent: ${decision.intent}`);
        if (decision.intent === 'unknown') {
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
    // this.scope.runFlow('mcp:transport:stateful-http', this.rawInput);
    this.next();
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

      // Terminate the session - this unregisters the server AND adds to terminated set
      // This prevents future requests with this session ID from being accepted
      const wasRegistered = this.scope.notifications.terminateSession(sessionId);

      if (!wasRegistered) {
        // Session not found - per MCP spec, return 404
        // Note: We still added it to terminated set to prevent future use
        this.logger.warn(`[${this.requestId}] Session not found for DELETE: ${sessionId}`);
        this.respond(httpRespond.notFound('Session not found'));
        return;
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
