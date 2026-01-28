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
  FlowControl,
  validateMcpSessionHeader,
} from '../../common';
import { InternalMcpError } from '../../errors';
import { z } from 'zod';
import { ElicitResultSchema, RequestSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { Scope } from '../../scope';
import { createSessionId } from '../../auth/session/utils/session-id.utils';
import { detectSkillsOnlyMode } from '../../skill/skill-mode.utils';
import { createExtAppsMessageHandler, type ExtAppsJsonRpcRequest, type ExtAppsHostCapabilities } from '../../ext-apps';

export const plan = {
  pre: ['parseInput', 'router'],
  execute: ['onInitialize', 'onMessage', 'onElicitResult', 'onSseListener', 'onExtApps'],
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
  requestType: z.enum(['initialize', 'message', 'elicitResult', 'sseListener', 'extApps']).optional(),
});

const name = 'handle:streamable-http' as const;
const { Stage } = FlowHooksOf(name);

declare global {
  interface ExtendFlows {
    'handle:streamable-http': FlowRunOptions<
      HandleStreamableHttpFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof httpOutputSchema,
      typeof stateSchema
    >;
  }
}

@Flow({
  name,
  plan,
  access: 'authorized',
  inputSchema: httpInputSchema,
  outputSchema: httpOutputSchema,
})
export default class HandleStreamableHttpFlow extends FlowBase<typeof name> {
  name = name;

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
    // Priority 2: Use session from authorization if header matches or is absent
    // Priority 3: Create new session (first request - no header, no authorization.session)
    const raw = request.headers?.['mcp-session-id'];
    const rawMcpSessionHeader = typeof raw === 'string' ? raw : undefined;
    const mcpSessionHeader = validateMcpSessionHeader(rawMcpSessionHeader);

    // If client sent a header but validation failed, return 404
    if (raw !== undefined && !mcpSessionHeader) {
      this.respond(httpRespond.sessionNotFound('invalid session id'));
      return;
    }

    let session: { id: string; payload?: z.infer<typeof stateSchema>['session']['payload'] };

    if (mcpSessionHeader) {
      // Client sent session ID - ALWAYS use it for transport lookup
      // If authorization.session exists and matches, use its payload for protocol detection
      // If authorization.session differs or is missing, still use header ID (payload may be undefined)
      if (authorization.session?.id === mcpSessionHeader) {
        session = authorization.session;
      } else {
        session = { id: mcpSessionHeader };
      }
    } else if (authorization.session) {
      // No header but authorization has session - use it (shouldn't happen in normal flow)
      session = authorization.session;
    } else {
      // No session - create new one (initialize request)
      // Detect skills_only mode from query params
      const query = request.query as Record<string, string | string[]> | undefined;
      const skillsOnlyMode = detectSkillsOnlyMode(query);

      session = createSessionId('streamable-http', token, {
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

    // GET requests are SSE listener streams - no body expected
    // Per MCP spec, clients can open SSE stream with GET + Accept: text/event-stream
    if (request.method.toUpperCase() === 'GET') {
      this.state.set('requestType', 'sseListener');
      return;
    }

    // POST requests have MCP JSON-RPC body
    const body = request.body as { method?: string } | undefined;
    const method = body?.method;

    // Use method-based detection for routing (more permissive than strict schema)
    // The actual schema validation happens in the MCP SDK's transport layer
    if (method === 'initialize') {
      this.state.set('requestType', 'initialize');
    } else if (typeof method === 'string' && method.startsWith('ui/')) {
      // Ext-apps methods: ui/initialize, ui/callServerTool, etc.
      this.state.set('requestType', 'extApps');
    } else if (ElicitResultSchema.safeParse((request.body as { result?: unknown })?.result).success) {
      this.state.set('requestType', 'elicitResult');
    } else if (method && RequestSchema.safeParse(request.body).success) {
      this.state.set('requestType', 'message');
    } else {
      this.respond(httpRespond.rpcError('Invalid Request'));
    }
  }

  @Stage('onInitialize', {
    filter: ({ state: { requestType } }) => requestType === 'initialize',
  })
  async onInitialize() {
    const transportService = (this.scope as Scope).transportService;
    const logger = (this.scope as Scope).logger.child('handle:streamable-http:onInitialize');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    logger.info('onInitialize: creating transport', {
      sessionId: session.id.slice(0, 30),
      hasToken: !!token,
      tokenPrefix: token?.slice(0, 10),
    });

    try {
      const transport = await transportService.createTransporter('streamable-http', token, session.id, response);
      logger.info('onInitialize: transport created, calling initialize');
      await transport.initialize(request, response);
      logger.info('onInitialize: completed successfully');
      this.handled();
    } catch (error) {
      // FlowControl is expected control flow (from this.handled()), not an error
      if (error instanceof FlowControl) {
        throw error;
      }
      logger.error('onInitialize: failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  @Stage('onElicitResult', {
    filter: ({ state: { requestType } }) => requestType === 'elicitResult',
  })
  async onElicitResult() {
    const transportService = (this.scope as Scope).transportService;
    const logger = this.scopeLogger.child('handle:streamable-http:onElicitResult');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    logger.info('onElicitResult: starting', {
      sessionId: session.id?.slice(0, 20),
      hasToken: !!token,
    });

    // 1. Try to get existing transport from memory
    let transport = await transportService.getTransporter('streamable-http', token, session.id);

    // 2. If not in memory, check if session exists in Redis and recreate
    // This mirrors the onMessage flow to support distributed mode where the
    // elicitation result may arrive on a different node than the original request.
    if (!transport) {
      try {
        logger.info('onElicitResult: transport not in memory, checking stored session', {
          sessionId: session.id?.slice(0, 20),
        });
        const storedSession = await transportService.getStoredSession('streamable-http', token, session.id);
        if (storedSession) {
          logger.info('onElicitResult: recreating transport from stored session', {
            sessionId: session.id?.slice(0, 20),
            createdAt: storedSession.createdAt,
            initialized: storedSession.initialized,
          });
          transport = await transportService.recreateTransporter(
            'streamable-http',
            token,
            session.id,
            storedSession,
            response,
          );
        }
      } catch (error) {
        logger.warn('onElicitResult: failed to recreate transport from stored session', {
          sessionId: session.id?.slice(0, 20),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!transport) {
      logger.warn('onElicitResult: transport not found', {
        sessionId: session.id?.slice(0, 20),
      });
      this.respond(httpRespond.sessionExpired('session not found'));
      return;
    }

    // Pass to transport's handleRequest which calls handleIfElicitResult
    await transport.handleRequest(request, response);

    // If handleIfElicitResult returned true, the elicit result was processed
    // but no response was sent. Send 202 Accepted to acknowledge receipt.
    if (!response.writableEnded) {
      response.status(202).json({ jsonrpc: '2.0', result: {} });
    }

    this.handled();
  }

  @Stage('onMessage', {
    filter: ({ state: { requestType } }) => requestType === 'message',
  })
  async onMessage() {
    const transportService = (this.scope as Scope).transportService;
    const logger = this.scopeLogger.child('handle:streamable-http:onMessage');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    logger.info('onMessage: starting', {
      sessionId: session.id?.slice(0, 20),
      hasToken: !!token,
    });

    // 1. Try to get existing transport from memory
    let transport = await transportService.getTransporter('streamable-http', token, session.id);
    logger.info('onMessage: getTransporter result', { found: !!transport });

    // 2. If not in memory, check if session exists in Redis and recreate
    if (!transport) {
      try {
        logger.info('onMessage: transport not in memory, checking Redis', {
          sessionId: session.id?.slice(0, 20),
        });
        const storedSession = await transportService.getStoredSession('streamable-http', token, session.id);
        logger.info('onMessage: getStoredSession result', {
          found: !!storedSession,
          initialized: storedSession?.initialized,
        });
        if (storedSession) {
          logger.info('Recreating transport from Redis session', {
            sessionId: session.id?.slice(0, 20),
            createdAt: storedSession.createdAt,
            initialized: storedSession.initialized,
          });
          transport = await transportService.recreateTransporter(
            'streamable-http',
            token,
            session.id,
            storedSession,
            response,
          );
          logger.info('onMessage: transport recreated successfully');
        }
      } catch (error) {
        // Log and fall through to 404 logic - transport remains undefined
        logger.warn('Failed to recreate transport from stored session', {
          sessionId: session.id?.slice(0, 20),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!transport) {
      // Check if session was ever created to differentiate error types per MCP Spec 2025-11-25
      const wasCreated = await transportService.wasSessionCreatedAsync('streamable-http', token, session.id);
      const body = request.body as Record<string, unknown> | undefined;

      if (wasCreated) {
        // Session existed but was terminated/evicted → HTTP 404 (client should re-initialize)
        logger.info('Session expired - client should re-initialize', {
          sessionId: session.id?.slice(0, 20),
          tokenHash: token.slice(0, 8),
          method: body?.['method'],
          requestId: body?.['id'],
          mcpSessionId: request.headers?.['mcp-session-id'],
        });
        this.respond(httpRespond.sessionExpired('session expired'));
      } else {
        // Session was never created → HTTP 404 (per user requirement: invalid/missing session = 404)
        logger.warn('Session not initialized - client attempted request without initializing', {
          sessionId: session.id?.slice(0, 20),
          tokenHash: token.slice(0, 8),
          method: body?.['method'],
          requestId: body?.['id'],
          mcpSessionId: request.headers?.['mcp-session-id'],
          userAgent: (request.headers?.['user-agent'] as string | undefined)?.slice(0, 50),
        });
        this.respond(httpRespond.sessionNotFound('session not initialized'));
      }
      return;
    }

    try {
      await transport.handleRequest(request, response);
      this.handled();
    } catch (error) {
      // FlowControl is expected control flow, not an error
      if (!(error instanceof FlowControl)) {
        const body = request.body as Record<string, unknown> | undefined;
        logger.error('handleRequest failed', {
          error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
          method: body?.['method'],
          id: body?.['id'],
          sessionId: session.id?.slice(0, 20),
        });
      }
      throw error;
    }
  }

  @Stage('onSseListener', {
    filter: ({ state: { requestType } }) => requestType === 'sseListener',
  })
  async onSseListener() {
    const transportService = (this.scope as Scope).transportService;
    const logger = this.scopeLogger.child('handle:streamable-http:onSseListener');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    // 1. Try to get existing transport from memory
    let transport = await transportService.getTransporter('streamable-http', token, session.id);

    // 2. If not in memory, check if session exists in Redis and recreate
    if (!transport) {
      try {
        const storedSession = await transportService.getStoredSession('streamable-http', token, session.id);
        if (storedSession) {
          logger.info('Recreating transport from Redis session for SSE listener', {
            sessionId: session.id?.slice(0, 20),
            createdAt: storedSession.createdAt,
          });
          transport = await transportService.recreateTransporter(
            'streamable-http',
            token,
            session.id,
            storedSession,
            response,
          );
        }
      } catch (error) {
        // Log and fall through to 404 logic - transport remains undefined
        logger.warn('Failed to recreate transport from stored session for SSE listener', {
          sessionId: session.id?.slice(0, 20),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!transport) {
      this.respond(httpRespond.notFound('Session not found'));
      return;
    }

    // Forward GET request to transport (opens SSE stream for server→client notifications)
    await transport.handleRequest(request, response);
    this.handled();
  }

  @Stage('onExtApps', {
    filter: ({ state: { requestType } }) => requestType === 'extApps',
  })
  async onExtApps() {
    const transportService = (this.scope as Scope).transportService;
    const logger = this.scopeLogger.child('handle:streamable-http:onExtApps');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    logger.info('onExtApps: starting', {
      sessionId: session.id?.slice(0, 20),
      method: (request.body as { method?: string })?.method,
    });

    // 1. Try to get existing transport from memory
    let transport = await transportService.getTransporter('streamable-http', token, session.id);

    // 2. If not in memory, check if session exists in storage and recreate
    if (!transport) {
      try {
        logger.info('onExtApps: transport not in memory, checking stored session', {
          sessionId: session.id?.slice(0, 20),
        });
        const storedSession = await transportService.getStoredSession('streamable-http', token, session.id);
        if (storedSession) {
          logger.info('onExtApps: recreating transport from stored session', {
            sessionId: session.id?.slice(0, 20),
            createdAt: storedSession.createdAt,
            initialized: storedSession.initialized,
          });
          transport = await transportService.recreateTransporter(
            'streamable-http',
            token,
            session.id,
            storedSession,
            response,
          );
        }
      } catch (error) {
        logger.warn('onExtApps: failed to recreate transport from stored session', {
          sessionId: session.id?.slice(0, 20),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 3. Session validation - same as onMessage
    if (!transport) {
      const wasCreated = await transportService.wasSessionCreatedAsync('streamable-http', token, session.id);
      if (wasCreated) {
        this.respond(httpRespond.sessionExpired('session expired'));
      } else {
        this.respond(httpRespond.sessionNotFound('session not initialized'));
      }
      return;
    }

    // 4. Create ExtAppsMessageHandler with session context
    const scope = this.scope as Scope;

    // Get host capabilities from scope metadata, with defaults
    const configuredCapabilities = scope.metadata.extApps?.hostCapabilities;
    const hostCapabilities: ExtAppsHostCapabilities = {
      serverToolProxy: configuredCapabilities?.serverToolProxy ?? true,
      logging: configuredCapabilities?.logging ?? true,
      ...configuredCapabilities,
    };

    const handler = createExtAppsMessageHandler({
      context: {
        sessionId: session.id,
        logger: scope.logger,
        callTool: async (name, args) => {
          // Route through CallToolFlow with session's authInfo
          const result = await scope.runFlow('tools:call-tool', {
            request: { method: 'tools/call', params: { name, arguments: args } },
            ctx: {
              authInfo: {
                sessionId: session.id,
                sessionIdPayload: session.payload,
                token,
              },
            },
          });
          // Parse and return the tool result
          const parsed = CallToolResultSchema.safeParse(result);
          if (parsed.success) {
            return parsed.data;
          }
          // Follow pattern from call-tool-request.handler.ts
          throw new InternalMcpError('Tool call returned invalid result format');
        },
        // Additional callbacks can be added here as needed:
        // updateModelContext, openLink, setDisplayMode, close, registerTool, unregisterTool
      },
      hostCapabilities,
    });

    // 5. Handle the request
    const jsonRpcRequest = request.body as ExtAppsJsonRpcRequest;
    const jsonRpcResponse = await handler.handleRequest(jsonRpcRequest);

    // 6. Send response
    response.status(200).json(jsonRpcResponse);
    this.handled();
  }
}
