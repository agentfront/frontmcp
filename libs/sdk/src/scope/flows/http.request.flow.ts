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
  execute: ['handleLegacySse', 'handleSse', 'handleStreamableHttp', 'handleStatefulHttp', 'handleStatelessHttp'],
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
    return requestPath === `${prefix}${scopePath}` || requestPath === `${prefix}${scopePath}/message`;
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
    const decision = decideIntent(request, {
      enableLegacySSE: true,
      enableSseListener: true,
      enableStatelessHttp: false,
      enableStatefulHttp: false,
      enableStreamableHttp: true,
      requireSessionForStreamable: true,
      tolerateMissingAccept: true,
    });

    const { verifyResult } = this.state.required;
    if (verifyResult.kind === 'authorized') {
      const { authorization } = verifyResult;
      request[ServerRequestTokens.auth] = authorization;
      if (authorization.session) {
        request[ServerRequestTokens.sessionId] = authorization.session.id;

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
    // this.scope.runFlow('mcp:transport:stateless-http', this.rawInput);
    this.next();
  }
}
