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
} from '../../common';
import { z } from 'zod';
import { sessionVerifyOutputSchema } from '../../auth/flows/session.verify.flow';

const plan = {
  pre: [
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
  error: ['error'],
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

  @Stage('checkAuthorization')
  async checkAuthorization() {
    const { request } = this.rawInput;
    this.logger.info(`New request: ${request.method} ${request.path}`);

    const result = await this.scope.runFlow('session:verify', { request });
    if (!result) {
      this.logger.error('failed to to verify session');
      throw new Error('Session verification failed');
    }
    this.state.set({
      verifyResult: result,
    });
  }

  @Stage('router')
  async router() {
    const { request } = this.rawInput;
    this.logger.verbose('check request decision');

    // Use transport config directly from auth (already parsed with defaults by Zod)
    const transport = this.scope.auth.transport;
    const decision = decideIntent(request, { ...transport, tolerateMissingAccept: true });

    // Handle DELETE method immediately - it's for session termination
    // regardless of what protocol the session was created with
    if (request.method.toUpperCase() === 'DELETE') {
      this.logger.verbose(`DELETE request, using decision intent: ${decision.intent}`);
      if (decision.intent === 'unknown') {
        // DELETE without session ID - forward to next middleware
        // to allow custom DELETE handlers by developers
        this.logger.verbose('DELETE with unknown intent, forwarding to next middleware');
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
      if (authorization.session) {
        const sessionId = authorization.session.id;
        request[ServerRequestTokens.sessionId] = sessionId;

        // Check if the session has been terminated (via DELETE)
        // Per MCP spec, requests to terminated sessions should return 404
        if (this.scope.notifications.isSessionTerminated(sessionId)) {
          this.logger.warn(`Request to terminated session: ${sessionId.slice(0, 20)}...`);
          this.respond(httpRespond.notFound('Session not found'));
          return;
        }

        // Safely access payload.protocol with null check
        const protocol = authorization.session.payload?.protocol;
        if (protocol) {
          this.logger.info(`decision from session: ${protocol}`);
          this.state.set('intent', protocol);
          return;
        }
      }

      if (decision.intent === 'unknown') {
        // continue to other middleware
        // with authentication (public/authorized routes)
        this.logger.verbose(`decision is unknown, continue to next http middleware`);
        this.next();
      }

      // register decision intent to state
      // and move to next stage
      this.logger.verbose(`decision is request info: ${decision.intent}`);
      this.state.set('intent', decision.intent);
    } else {
      this.logger.verbose(`not authorized request, check decision intent: ${decision.intent}`);
      if (decision.intent === 'unknown') {
        this.logger.verbose(`decision is unknown, continue to other public http middleware`);
        // continue to other middleware
        // without authentication (public routes)
        this.next();
      }

      this.logger.warn(`decision is ${decision.intent}, but not authorized, respond with 401`);
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
  }

  @Stage('handleLegacySse', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'legacy-sse',
  })
  async handleLegacySse() {
    const response = await this.scope.runFlow('handle:legacy-sse', this.rawInput);
    if (response) {
      this.respond(response);
    }
    this.handled();
  }

  @Stage('handleSse', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'sse',
  })
  async handleSse() {
    const response = await this.scope.runFlow('handle:streamable-http', this.rawInput);
    if (response) {
      this.respond(response);
    }
    this.next();
  }

  @Stage('handleStreamableHttp', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'streamable-http',
  })
  async handleStreamableHttp() {
    const response = await this.scope.runFlow('handle:streamable-http', this.rawInput);
    if (response) {
      this.respond(response);
    }
    this.next();
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
    const response = await this.scope.runFlow('handle:stateless-http', this.rawInput);
    if (response) {
      this.respond(response);
    }
    this.handled();
  }

  @Stage('handleDeleteSession', {
    filter: ({
      state: {
        required: { intent },
      },
    }) => intent === 'delete-session',
  })
  async handleDeleteSession() {
    const { request } = this.rawInput;
    const sessionId =
      request[ServerRequestTokens.sessionId] ??
      Object.entries(request.headers).find(([k]) => k.toLowerCase() === 'mcp-session-id')?.[1];

    if (!sessionId || typeof sessionId !== 'string') {
      this.logger.warn('DELETE request without valid session ID');
      this.respond(httpRespond.rpcError('No valid session ID provided'));
      return;
    }

    this.logger.info(`DELETE session: ${sessionId}`);

    // Terminate the session - this unregisters the server AND adds to terminated set
    // This prevents future requests with this session ID from being accepted
    const wasRegistered = this.scope.notifications.terminateSession(sessionId);

    if (!wasRegistered) {
      // Session not found - per MCP spec, return 404
      // Note: We still added it to terminated set to prevent future use
      this.logger.warn(`Session not found for DELETE: ${sessionId}`);
      this.respond(httpRespond.notFound('Session not found'));
      return;
    }

    this.logger.info(`Session terminated: ${sessionId}`);
    this.respond(httpRespond.noContent());
  }
}
