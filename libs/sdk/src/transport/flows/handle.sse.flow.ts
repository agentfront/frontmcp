import { z } from '@frontmcp/lazy-zod';

import { createSessionId } from '../../auth/session/utils/session-id.utils';
import {
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  httpOutputSchema,
  httpRespond,
  normalizeEntryPrefix,
  normalizeScopeBase,
  ServerRequestTokens,
  validateMcpSessionHeader,
  type Authorization,
  type FlowPlan,
  type FlowRunOptions,
} from '../../common';
import { TransportServiceNotAvailableError } from '../../errors';
import { applyNodeAffinity } from '../../ha/ha-headers';
import { detectSkillsOnlyMode } from '../../skill/skill-mode.utils';

export const plan = {
  pre: ['parseInput', 'router'],
  execute: ['onInitialize', 'onMessage', 'onElicitResult'],
  post: [],
  finalize: ['cleanup'],
} as const satisfies FlowPlan<string>;

// Relaxed session schema for state - payload is optional when using mcp-session-id header directly
const stateSessionSchema = z.object({
  id: z.string(),
  payload: z
    .object({
      nodeId: z.string(),
      authSig: z.string(),
      uuid: z.string().uuid(),
      iat: z.number(),
      protocol: z.enum(['legacy-sse', 'sse', 'streamable-http', 'stateful-http', 'stateless-http']).optional(),
      isPublic: z.boolean().optional(),
      platformType: z
        .enum(['openai', 'claude', 'gemini', 'cursor', 'continue', 'cody', 'generic-mcp', 'ext-apps', 'unknown'])
        .optional(),
    })
    .optional(),
});

export const stateSchema = z.object({
  token: z.string(),
  session: stateSessionSchema,
  requestType: z.enum(['initialize', 'message', 'elicitResult']).optional(),
});

const name = 'handle:legacy-sse' as const;
const { Stage } = FlowHooksOf(name);

declare global {
  interface ExtendFlows {
    'handle:legacy-sse': FlowRunOptions<
      HandleSseFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof httpOutputSchema,
      typeof stateSchema
    >;
  }
}

/** Extract sessionId from query string for legacy SSE /message endpoint */
export function getQuerySessionId(urlPath?: string): string | undefined {
  if (!urlPath) return undefined;
  try {
    const u = new URL(String(urlPath), 'http://local');
    return u.searchParams.get('sessionId') ?? undefined;
  } catch {
    return undefined;
  }
}

type LegacySseSession = z.infer<typeof stateSchema>['session'];

/**
 * Resolve the session a legacy SSE request belongs to.
 *
 * The client names its session with the `mcp-session-id` header or, on the
 * legacy `/message` endpoint, the `?sessionId=` query param (header first — the
 * same order `session:verify` reads them in). A named id is honored only when
 * `session:verify` verified that exact id; anything else is answered 404 so the
 * client reconnects. Anonymous and static-key sessions share `token: ''`, so the
 * id is their only credential — a raw, unverified id must never become a
 * transport key.
 */
export function resolveLegacySseSession(params: {
  rawHeader: unknown;
  requestUrl?: string;
  authorizationSession?: LegacySseSession;
  createSession: () => LegacySseSession;
}): { responded404: boolean; session?: LegacySseSession; createdNew: boolean } {
  const { rawHeader, requestUrl, authorizationSession, createSession } = params;
  const rawMcpSessionHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
  const mcpSessionHeader = validateMcpSessionHeader(rawMcpSessionHeader);

  // Also check for sessionId in query params (legacy SSE sends it there)
  const querySessionId = getQuerySessionId(requestUrl);
  const validatedQuerySessionId = querySessionId ? validateMcpSessionHeader(querySessionId) : undefined;

  // A header or query param that fails format validation is a 404
  if (rawHeader !== undefined && !mcpSessionHeader) {
    return { responded404: true, createdNew: false };
  }
  if (querySessionId !== undefined && !validatedQuerySessionId) {
    return { responded404: true, createdNew: false };
  }

  // Use header session ID first, then query param (legacy SSE /message endpoint)
  const effectiveSessionId = mcpSessionHeader ?? validatedQuerySessionId;

  if (effectiveSessionId) {
    if (authorizationSession?.id === effectiveSessionId) {
      return { session: authorizationSession, createdNew: false, responded404: false };
    }
    return { responded404: true, createdNew: false };
  }

  if (authorizationSession) {
    // No id presented: anonymous modes mint the session in session:verify
    return { session: authorizationSession, createdNew: false, responded404: false };
  }

  // No session - create new one (initialize request)
  return { session: createSession(), createdNew: true, responded404: false };
}

@Flow({
  name,
  access: 'authorized',
  inputSchema: httpInputSchema,
  outputSchema: httpOutputSchema,
  plan,
})
export default class HandleSseFlow extends FlowBase<typeof name> {
  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;

    const authorization = request[ServerRequestTokens.auth] as Authorization;
    const { token } = authorization;

    // The session is named by the mcp-session-id header or, on the legacy
    // /message endpoint, the sessionId query param. Only an id session:verify
    // verified is used for the transport lookup — see resolveLegacySseSession.
    const anyReq = request as { url?: string; path?: string };
    const resolution = resolveLegacySseSession({
      rawHeader: request.headers?.['mcp-session-id'],
      requestUrl: anyReq.url ?? anyReq.path,
      authorizationSession: authorization.session,
      createSession: () => {
        // Detect skills_only mode from query params
        const query = request.query as Record<string, string | string[]> | undefined;
        const skillsOnlyMode = detectSkillsOnlyMode(query);

        return createSessionId('legacy-sse', token, {
          userAgent: request.headers?.['user-agent'] as string | undefined,
          platformDetectionConfig: this.scope.metadata.transport?.platformDetection,
          skillsOnlyMode,
        });
      },
    });

    if (resolution.responded404 || !resolution.session) {
      this.respond(httpRespond.sessionNotFound('invalid session id'));
      return;
    }

    const session = resolution.session;

    this.state.set(stateSchema.parse({ token, session }));
  }

  @Stage('router')
  async router() {
    const { request } = this.rawInput;
    const requestPath = normalizeEntryPrefix(request.path);
    const prefix = normalizeEntryPrefix(this.scope.entryPath);
    const scopePath = normalizeScopeBase(this.scope.routeBase);
    const basePath = `${prefix}${scopePath}`;

    if (requestPath === `${basePath}/sse`) {
      this.state.set('requestType', 'initialize');
    } else if (requestPath === `${basePath}/message`) {
      this.state.set('requestType', 'message');
    }
  }

  @Stage('onInitialize', {
    filter: ({ state: { requestType } }) => requestType === 'initialize',
  })
  async onInitialize() {
    const transportService = this.scope.transportService;
    if (!transportService) {
      throw new TransportServiceNotAvailableError();
    }

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;
    // A verified token (an anonymous grant included) arrives with no session: the transport reads the one minted here
    const authorization = request[ServerRequestTokens.auth] as Authorization;
    authorization.session ??= session;
    const transport = await transportService.createTransporter('sse', token, session.id, response);

    // Set LB affinity headers in distributed mode
    applyNodeAffinity(response, request);

    await transport.initialize(request, response);
    this.handled();
  }

  @Stage('onElicitResult', {
    filter: ({ state: { requestType } }) => requestType === 'elicitResult',
  })
  async onElicitResult() {
    // const transport = await transportService.getTransporter('sse', token, session.id);
    // if (!transport) {
    //   this.respond(httpRespond.rpcError('session not initialized'));
    //   return;
    // }
    // await transport.handleRequest(request, response);
    this.fail(new Error('Not implemented'));
  }

  @Stage('onMessage', {
    filter: ({ state: { requestType } }) => requestType === 'message',
  })
  async onMessage() {
    const transportService = this.scope.transportService;
    if (!transportService) {
      throw new TransportServiceNotAvailableError();
    }
    const logger = this.scopeLogger.child('handle:legacy-sse:onMessage');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    // Local transport, or — in a distributed deployment — a relay to the live node that holds
    // the session's SSE stream. An SSE session cannot be recreated on another node (its stream
    // is bound to the original connection), so when its owner stopped the client reconnects.
    const transport = await transportService.getTransporter('sse', token, session.id);

    if (!transport) {
      // Check if session was ever created to differentiate error types per MCP Spec 2025-11-25
      const wasCreated = await transportService.wasSessionCreatedAsync('sse', token, session.id);
      const body = request.body as Record<string, unknown> | undefined;

      if (wasCreated) {
        // Session existed but was terminated/evicted → HTTP 404 (client should re-initialize)
        logger.info('Session expired - client should re-initialize', {
          sessionId: session.id?.slice(0, 20),
          tokenHash: token.slice(0, 8),
          method: body?.['method'],
          requestId: body?.['id'],
        });
        this.respond(httpRespond.sessionExpired('session expired'));
      } else {
        // Session was never created → HTTP 404 (per user requirement: invalid/missing session = 404)
        logger.warn('Session not initialized - client attempted request without initializing', {
          sessionId: session.id?.slice(0, 20),
          tokenHash: token.slice(0, 8),
          method: body?.['method'],
          requestId: body?.['id'],
          userAgent: (request.headers?.['user-agent'] as string | undefined)?.slice(0, 50),
        });
        this.respond(httpRespond.sessionNotFound('session not initialized'));
      }
      return;
    }
    await transport.handleRequest(request, response);
    this.handled();
  }
}
