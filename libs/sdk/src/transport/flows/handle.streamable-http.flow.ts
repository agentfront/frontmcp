import { z } from 'zod';

import type { StoredSession } from '@frontmcp/auth';
import { CallToolResultSchema, ElicitResultSchema, RequestSchema } from '@frontmcp/protocol';
import { buildSetCookie, getMachineId, getRuntimeContext } from '@frontmcp/utils';

import { createSessionId } from '../../auth/session/utils/session-id.utils';
import {
  Flow,
  FlowBase,
  FlowControl,
  FlowHooksOf,
  httpInputSchema,
  httpOutputSchema,
  httpRespond,
  ServerRequestTokens,
  validateMcpSessionHeader,
  type Authorization,
  type FlowPlan,
  type FlowRunOptions,
  type ServerResponse,
} from '../../common';
import { InternalMcpError, TransportServiceNotAvailableError } from '../../errors';
import { createExtAppsMessageHandler, type ExtAppsHostCapabilities, type ExtAppsJsonRpcRequest } from '../../ext-apps';
import { DEFAULT_FRONTMCP_MACHINE_ID_HEADER, DEFAULT_FRONTMCP_NODE_COOKIE } from '../../ha/ha.constants';
import { detectSkillsOnlyMode } from '../../skill/skill-mode.utils';

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

type StreamableHttpSession = z.infer<typeof stateSchema>['session'];
export type StreamableHttpRequestType = NonNullable<z.infer<typeof stateSchema>['requestType']>;

export function resolveStreamableHttpSession(params: {
  rawHeader: unknown;
  authorizationSession?: StreamableHttpSession;
  createSession: () => StreamableHttpSession;
}): {
  responded404: boolean;
  session?: StreamableHttpSession;
  createdNew: boolean;
} {
  const { rawHeader, authorizationSession, createSession } = params;
  const rawMcpSessionHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
  const mcpSessionHeader = validateMcpSessionHeader(rawMcpSessionHeader);

  if (rawHeader !== undefined && !mcpSessionHeader) {
    return { responded404: true, createdNew: false };
  }

  if (mcpSessionHeader) {
    if (authorizationSession?.id === mcpSessionHeader) {
      return { session: authorizationSession, createdNew: false, responded404: false };
    }

    return { session: { id: mcpSessionHeader }, createdNew: false, responded404: false };
  }

  if (authorizationSession) {
    return { session: authorizationSession, createdNew: false, responded404: false };
  }

  return { session: createSession(), createdNew: true, responded404: false };
}

export function classifyStreamableHttpRequest(params: {
  method: string;
  body: unknown;
}): { requestType: StreamableHttpRequestType } | { error: 'Invalid Request' } {
  const { method, body } = params;

  if (method.toUpperCase() === 'GET') {
    return { requestType: 'sseListener' };
  }

  const jsonRpcMethod = (body as { method?: string } | undefined)?.method;

  if (jsonRpcMethod === 'initialize') {
    return { requestType: 'initialize' };
  }

  if (typeof jsonRpcMethod === 'string' && jsonRpcMethod.startsWith('ui/')) {
    return { requestType: 'extApps' };
  }

  if (ElicitResultSchema.safeParse((body as { result?: unknown } | undefined)?.result).success) {
    return { requestType: 'elicitResult' };
  }

  if (jsonRpcMethod && RequestSchema.safeParse(body).success) {
    return { requestType: 'message' };
  }

  return { error: 'Invalid Request' };
}

export function syncStreamableHttpAuthorizationSession(
  authorization: { session?: StreamableHttpSession },
  session: StreamableHttpSession,
): void {
  if (!authorization.session) {
    authorization.session = session;
  }
}

export interface StreamableHttpTransport {
  handleRequest(request: unknown, response: unknown): Promise<void>;
}

export interface StreamableHttpTransportLookupService {
  getTransporter(
    type: 'streamable-http',
    token: string,
    sessionId: string,
  ): Promise<StreamableHttpTransport | undefined>;
  getStoredSession(type: 'streamable-http', token: string, sessionId: string): Promise<StoredSession | undefined>;
  recreateTransporter(
    type: 'streamable-http',
    token: string,
    sessionId: string,
    storedSession: StoredSession,
    response: ServerResponse,
  ): Promise<StreamableHttpTransport | undefined>;
  wasSessionCreatedAsync(type: 'streamable-http', token: string, sessionId: string): Promise<boolean>;
}

export type StreamableHttpTransportLookupResult =
  | { kind: 'transport'; source: 'memory' | 'redis'; transport: StreamableHttpTransport }
  | { kind: 'session-expired'; recreationError?: unknown }
  | { kind: 'session-not-initialized'; recreationError?: unknown };

export async function lookupStreamableHttpTransport(params: {
  transportService: StreamableHttpTransportLookupService;
  token: string;
  sessionId: string;
  response: ServerResponse;
}): Promise<StreamableHttpTransportLookupResult> {
  const { transportService, token, sessionId, response } = params;

  const inMemoryTransport = await transportService.getTransporter('streamable-http', token, sessionId);
  if (inMemoryTransport) {
    return { kind: 'transport', source: 'memory', transport: inMemoryTransport };
  }

  let recreationError: unknown;
  try {
    const storedSession = await transportService.getStoredSession('streamable-http', token, sessionId);
    if (storedSession) {
      const recreatedTransport = await transportService.recreateTransporter(
        'streamable-http',
        token,
        sessionId,
        storedSession,
        response,
      );

      if (recreatedTransport) {
        return { kind: 'transport', source: 'redis', transport: recreatedTransport };
      }
    }
  } catch (error) {
    recreationError = error;
  }

  const wasCreated = await transportService.wasSessionCreatedAsync('streamable-http', token, sessionId);
  if (wasCreated) {
    return { kind: 'session-expired', recreationError };
  }

  return { kind: 'session-not-initialized', recreationError };
}

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
    const logger = this.scopeLogger.child('handle:streamable-http:parseInput');

    // Session resolution for initialize vs non-initialize requests:
    //
    // Initialize + valid signed mcp-session-id (authSig matches):
    //   → Reuse that session ID (re-initialize under same ID)
    // Initialize + no/invalid mcp-session-id:
    //   → Create a new session with new ID
    // Initialize + active session (transport exists):
    //   → MCP SDK rejects with 400 "Server already initialized"
    // Non-initialize:
    //   → Standard resolution: header → auth session → error
    const body = request.body as { method?: string } | undefined;
    const isInitialize = body?.method === 'initialize';

    const createSession = () => {
      const query = request.query as Record<string, string | string[]> | undefined;
      const skillsOnlyMode = detectSkillsOnlyMode(query);

      return createSessionId('streamable-http', token, {
        userAgent: request.headers?.['user-agent'] as string | undefined,
        platformDetectionConfig: this.scope.metadata.transport?.platformDetection,
        skillsOnlyMode,
      });
    };

    let sessionResolution: ReturnType<typeof resolveStreamableHttpSession>;

    if (isInitialize) {
      // For initialize: reuse the session ID if the session verify flow resolved one.
      // authorization.session.id is set when the client sends a valid mcp-session-id
      // header that decrypts successfully (or is recognized in anonymous/public mode).
      // The payload may be undefined (e.g., nodeId mismatch after restart, terminated
      // session with cleared cache) — but the id is still the correct transport key.
      if (authorization.session?.id) {
        // Session ID resolved from header — reuse it for re-initialization
        sessionResolution = { session: authorization.session, createdNew: false, responded404: false };
      } else {
        // No session header / invalid / unrecognized — create fresh
        sessionResolution = { session: createSession(), createdNew: true, responded404: false };
      }
    } else {
      // Non-initialize: standard session resolution
      sessionResolution = resolveStreamableHttpSession({
        rawHeader: request.headers?.['mcp-session-id'],
        authorizationSession: authorization.session,
        createSession,
      });
    }

    if (sessionResolution.responded404 || !sessionResolution.session) {
      logger.warn('parseInput: invalid mcp-session-id header');
      this.respond(httpRespond.sessionNotFound('invalid session id'));
      return;
    }

    const session = sessionResolution.session;

    this.state.set(stateSchema.parse({ token, session }));

    logger.info('parseInput: session resolved', { sessionId: session.id?.slice(0, 20) });
  }

  @Stage('router')
  async router() {
    const { request } = this.rawInput;
    const logger = this.scopeLogger.child('handle:streamable-http:router');

    const classification = classifyStreamableHttpRequest({
      method: request.method,
      body: request.body,
    });

    if ('error' in classification) {
      logger.warn('router: invalid request, no valid method');
      this.respond(httpRespond.rpcError('Invalid Request'));
      return;
    }

    this.state.set('requestType', classification.requestType);

    if (classification.requestType === 'sseListener') {
      logger.info('router: requestType=sseListener, method=GET');
    } else if (classification.requestType === 'initialize') {
      logger.info('router: requestType=initialize, method=POST');
    } else if (classification.requestType === 'extApps') {
      const method = (request.body as { method?: string } | undefined)?.method;
      logger.info(`router: requestType=extApps, method=${method}`);
    } else if (classification.requestType === 'elicitResult') {
      logger.info('router: requestType=elicitResult, method=POST');
    } else {
      const method = (request.body as { method?: string } | undefined)?.method;
      logger.info(`router: requestType=message, method=${method}`);
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
    const logger = this.scope.logger.child('handle:streamable-http:onInitialize');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    logger.info('onInitialize: creating transport', {
      sessionId: session.id?.slice(0, 20),
      hasToken: !!token,
      tokenPrefix: token?.slice(0, 10),
    });

    try {
      // Sync session to request auth context for ensureAuthInfo.
      // Ensures the transport adapter's ensureAuthInfo gets the correct
      // session ID (particularly for fresh connections without a prior session).
      const authorization = request[ServerRequestTokens.auth] as Authorization;
      syncStreamableHttpAuthorizationSession(authorization, session);

      const transport = await transportService.createTransporter('streamable-http', token, session.id, response);

      // If the transport is already initialized:
      // - For re-initialization of a terminated session (reinitialize flag set by router):
      //   The transport may still exist in the registry from before DELETE.
      //   Reset it so the MCP SDK accepts the new initialize request.
      // - For an active session the client didn't DELETE:
      //   The MCP SDK rejects with 400 "Server already initialized".
      const isReinitialize = !!request[ServerRequestTokens.reinitialize];
      if (transport.isInitialized && isReinitialize) {
        logger.info('onInitialize: transport already initialized, resetting for re-initialization', {
          sessionId: session.id?.slice(0, 20),
        });
        transport.resetForReinitialization();
        // Re-register the MCP server with NotificationService.
        // terminateSession (from DELETE) called unregisterServer which removed the
        // server from the map. Without re-registering, setClientCapabilities,
        // setClientInfo, setLogLevel, and broadcast notifications would all fail.
        transport.reregisterServer();
      }

      // Set LB affinity headers in distributed mode
      if (getRuntimeContext().deployment === 'distributed') {
        const nodeId = getMachineId();
        response.setHeader(DEFAULT_FRONTMCP_MACHINE_ID_HEADER, nodeId);
        const cookie = buildSetCookie({ name: DEFAULT_FRONTMCP_NODE_COOKIE, value: nodeId }, request);
        if (cookie) {
          response.setHeader('Set-Cookie', cookie);
        }
      }

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
    const transportService = this.scope.transportService;
    if (!transportService) {
      throw new TransportServiceNotAvailableError();
    }
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
        logger.verbose('onElicitResult: transport not in memory, checking stored session', {
          sessionId: session.id?.slice(0, 20),
        });
        const storedSession = await transportService.getStoredSession('streamable-http', token, session.id);
        if (storedSession) {
          logger.verbose('onElicitResult: recreating transport from stored session', {
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
    const transportService = this.scope.transportService;
    if (!transportService) {
      throw new TransportServiceNotAvailableError();
    }
    const logger = this.scopeLogger.child('handle:streamable-http:onMessage');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    logger.info('onMessage: starting', {
      sessionId: session.id?.slice(0, 20),
      hasToken: !!token,
    });

    const transportLookup = await lookupStreamableHttpTransport({
      transportService,
      token,
      sessionId: session.id,
      response,
    });

    if (transportLookup.kind !== 'transport') {
      const body = request.body as Record<string, unknown> | undefined;

      if (transportLookup.recreationError) {
        logger.warn('Failed to recreate transport from stored session', {
          sessionId: session.id?.slice(0, 20),
          error:
            transportLookup.recreationError instanceof Error
              ? transportLookup.recreationError.message
              : String(transportLookup.recreationError),
        });
      }

      if (transportLookup.kind === 'session-expired') {
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

    const transport = transportLookup.transport;
    logger.verbose('onMessage: transport resolved', { source: transportLookup.source });

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
    const transportService = this.scope.transportService;
    if (!transportService) {
      throw new TransportServiceNotAvailableError();
    }
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
      logger.warn('onSseListener: transport not found', { sessionId: session.id?.slice(0, 20) });
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
    const transportService = this.scope.transportService;
    if (!transportService) {
      throw new TransportServiceNotAvailableError();
    }
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
        logger.verbose('onExtApps: transport not in memory, checking stored session', {
          sessionId: session.id?.slice(0, 20),
        });
        const storedSession = await transportService.getStoredSession('streamable-http', token, session.id);
        if (storedSession) {
          logger.verbose('onExtApps: recreating transport from stored session', {
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
        logger.info('onExtApps: session expired - client should re-initialize', {
          sessionId: session.id?.slice(0, 20),
        });
        this.respond(httpRespond.sessionExpired('session expired'));
      } else {
        logger.warn('onExtApps: session not initialized - client attempted request without initializing', {
          sessionId: session.id?.slice(0, 20),
        });
        this.respond(httpRespond.sessionNotFound('session not initialized'));
      }
      return;
    }

    // 4. Create ExtAppsMessageHandler with session context

    // Get host capabilities from scope metadata, with defaults
    const configuredCapabilities = this.scope.metadata.extApps?.hostCapabilities;
    const hostCapabilities: ExtAppsHostCapabilities = {
      serverToolProxy: configuredCapabilities?.serverToolProxy ?? true,
      logging: configuredCapabilities?.logging ?? true,
      ...configuredCapabilities,
    };

    const handler = createExtAppsMessageHandler({
      context: {
        sessionId: session.id,
        logger: this.scope.logger,
        callTool: async (name, args) => {
          // Route through CallToolFlow with session's authInfo
          const result = await this.scope.runFlow('tools:call-tool', {
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
