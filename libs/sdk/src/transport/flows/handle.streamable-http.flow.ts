import {
  Flow,
  httpInputSchema,
  FlowRunOptions,
  httpOutputSchema,
  FlowPlan,
  FlowBase,
  FlowHooksOf,
  sessionIdSchema,
  httpRespond,
  ServerRequestTokens,
  Authorization,
  FlowControl,
} from '../../common';
import { z } from 'zod';
import { ElicitResultSchema, RequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Scope } from '../../scope';
import { createSessionId } from '../../auth/session/utils/session-id.utils';

export const plan = {
  pre: ['parseInput', 'router'],
  execute: ['onInitialize', 'onMessage', 'onElicitResult', 'onSseListener'],
  post: [],
  finalize: ['cleanup'],
} as const satisfies FlowPlan<string>;

export const stateSchema = z.object({
  token: z.string(),
  session: sessionIdSchema,
  requestType: z.enum(['initialize', 'message', 'elicitResult', 'sseListener']).optional(),
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

    // Get session from authorization or create new one - stored only in state, not mutated on request
    // Pass user-agent for pre-initialize platform detection
    const session =
      authorization.session ??
      createSessionId('streamable-http', token, {
        userAgent: request.headers?.['user-agent'] as string | undefined,
        platformDetectionConfig: (this.scope as Scope).metadata?.session?.platformDetection,
      });
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
    } else if (ElicitResultSchema.safeParse(request.body).success) {
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

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;
    const transport = await transportService.createTransporter('streamable-http', token, session.id, response);
    await transport.initialize(request, response);
    this.handled();
  }

  @Stage('onElicitResult', {
    filter: ({ state: { requestType } }) => requestType === 'elicitResult',
  })
  async onElicitResult() {
    this.fail(new Error('Not implemented'));
  }

  @Stage('onMessage', {
    filter: ({ state: { requestType } }) => requestType === 'message',
  })
  async onMessage() {
    const transportService = (this.scope as Scope).transportService;
    const logger = this.scopeLogger.child('handle:streamable-http:onMessage');

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;
    const transport = await transportService.getTransporter('streamable-http', token, session.id);
    if (!transport) {
      this.respond(httpRespond.rpcError('session not initialized'));
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

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;

    // Get existing transport for this session - SSE listener requires existing session
    const transport = await transportService.getTransporter('streamable-http', token, session.id);
    if (!transport) {
      this.respond(httpRespond.notFound('Session not found'));
      return;
    }

    // Forward GET request to transport (opens SSE stream for server→client notifications)
    await transport.handleRequest(request, response);
    this.handled();
  }
}
