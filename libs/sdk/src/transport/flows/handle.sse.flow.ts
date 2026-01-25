import {
  Flow,
  httpInputSchema,
  FlowRunOptions,
  httpOutputSchema,
  FlowPlan,
  FlowBase,
  FlowHooksOf,
  httpRespond,
  ServerRequestTokens,
  Authorization,
  normalizeEntryPrefix,
  normalizeScopeBase,
  validateMcpSessionHeader,
} from '../../common';
import { z } from 'zod';
import { Scope } from '../../scope';
import { createSessionId } from '../../auth/session/utils/session-id.utils';
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
function getQuerySessionId(urlPath?: string): string | undefined {
  if (!urlPath) return undefined;
  try {
    const u = new URL(String(urlPath), 'http://local');
    return u.searchParams.get('sessionId') ?? undefined;
  } catch {
    return undefined;
  }
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

    // CRITICAL: The mcp-session-id header is the client's reference to their session.
    // We MUST use this exact ID for transport registry lookup.
    //
    // Priority 1: Use mcp-session-id header if present (client's session ID for lookup)
    //             This is the ID the client received from initialize and is referencing.
    // Priority 2: Use sessionId query param (for legacy SSE /message endpoint)
    //             The SSE transport sends: /message?sessionId=xxx
    // Priority 3: Use session from authorization if header matches or is absent
    // Priority 4: Create new session (first request - no header, no authorization.session)
    const raw = request.headers?.['mcp-session-id'];
    const rawMcpSessionHeader = typeof raw === 'string' ? raw : undefined;
    const mcpSessionHeader = validateMcpSessionHeader(rawMcpSessionHeader);

    // Also check for sessionId in query params (legacy SSE sends it there)
    const anyReq = request as { url?: string; path?: string };
    const querySessionId = getQuerySessionId(anyReq.url ?? anyReq.path);
    const validatedQuerySessionId = querySessionId ? validateMcpSessionHeader(querySessionId) : undefined;

    // If client sent a header but validation failed, return 404
    if (raw !== undefined && !mcpSessionHeader) {
      this.respond(httpRespond.sessionNotFound('invalid session id'));
      return;
    }

    // If client sent query param but validation failed, return 404
    if (querySessionId !== undefined && !validatedQuerySessionId) {
      this.respond(httpRespond.sessionNotFound('invalid session id'));
      return;
    }

    // Use header session ID first, then query param (legacy SSE /message endpoint)
    const effectiveSessionId = mcpSessionHeader ?? validatedQuerySessionId;

    let session: { id: string; payload?: z.infer<typeof stateSchema>['session']['payload'] };

    if (effectiveSessionId) {
      // Client sent session ID - ALWAYS use it for transport lookup
      // If authorization.session exists and matches, use its payload for protocol detection
      // If authorization.session differs or is missing, still use header ID (payload may be undefined)
      if (authorization.session?.id === effectiveSessionId) {
        session = authorization.session;
      } else {
        session = { id: effectiveSessionId };
      }
    } else if (authorization.session) {
      // No header but authorization has session - use it (shouldn't happen in normal flow)
      session = authorization.session;
    } else {
      // No session - create new one (initialize request)
      // Detect skills_only mode from query params
      const query = request.query as Record<string, string | string[]> | undefined;
      const skillsOnlyMode = detectSkillsOnlyMode(query);

      session = createSessionId('legacy-sse', token, {
        userAgent: request.headers?.['user-agent'] as string | undefined,
        platformDetectionConfig: (this.scope as Scope).metadata.transport?.platformDetection,
        skillsOnlyMode,
      });
    }

    this.state.set(stateSchema.parse({ token, session }));
  }

  @Stage('router')
  async router() {
    const { request } = this.rawInput;
    const scope = this.scope as Scope;
    const requestPath = normalizeEntryPrefix(request.path);
    const prefix = normalizeEntryPrefix(scope.entryPath);
    const scopePath = normalizeScopeBase(scope.routeBase);
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
    const transportService = (this.scope as Scope).transportService;

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;
    const transport = await transportService.createTransporter('sse', token, session.id, response);
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
    const transportService = (this.scope as Scope).transportService;
    const logger = this.scopeLogger.child('handle:legacy-sse:onMessage');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;
    const transport = await transportService.getTransporter('sse', token, session.id);
    if (!transport) {
      // Check if session was ever created to differentiate error types per MCP Spec 2025-11-25
      const wasCreated = transportService.wasSessionCreated('sse', token, session.id);
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
