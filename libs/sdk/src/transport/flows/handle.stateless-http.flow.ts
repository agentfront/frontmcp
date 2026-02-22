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
} from '../../common';
import { z } from 'zod';
import { RequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Scope } from '../../scope';

export const plan = {
  pre: ['parseInput', 'router'],
  execute: ['handleRequest'],
  post: [],
  finalize: ['cleanup'],
} as const satisfies FlowPlan<string>;

export const stateSchema = z.object({
  token: z.string().optional(),
  isAuthenticated: z.boolean(),
  requestType: z.enum(['initialize', 'message']).optional(),
});

const name = 'handle:stateless-http' as const;
const { Stage } = FlowHooksOf(name);

declare global {
  interface ExtendFlows {
    'handle:stateless-http': FlowRunOptions<
      HandleStatelessHttpFlow,
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
  access: 'public', // Can be accessed without full auth
  inputSchema: httpInputSchema,
  outputSchema: httpOutputSchema,
})
export default class HandleStatelessHttpFlow extends FlowBase<typeof name> {
  name = name;

  @Stage('parseInput')
  async parseInput() {
    const { request } = this.rawInput;
    const logger = (this.scope as Scope).logger.child('HandleStatelessHttpFlow');

    // Check if we have auth info
    const auth = request[ServerRequestTokens.auth] as Authorization | undefined;
    const token = auth?.token;
    const isAuthenticated = !!token && token.length > 0;

    logger.verbose('parseInput', { isAuthenticated, hasToken: !!token });

    this.state.set(
      stateSchema.parse({
        token: token || undefined,
        isAuthenticated,
      }),
    );
  }

  @Stage('router')
  async router() {
    const { request } = this.rawInput;
    const logger = (this.scope as Scope).logger.child('HandleStatelessHttpFlow');
    const body = request.body as { method?: string } | undefined;
    const method = body?.method;

    // Use method-based detection for routing (more permissive than strict schema)
    // The actual schema validation happens in the MCP SDK's transport layer
    if (method === 'initialize') {
      this.state.set('requestType', 'initialize');
      logger.info('router: requestType=initialize, method=POST');
    } else if (method && RequestSchema.safeParse(request.body).success) {
      this.state.set('requestType', 'message');
      logger.info(`router: requestType=message, method=${method}`);
    } else {
      logger.warn('router: invalid request, no valid method');
      this.respond(httpRespond.rpcError('Invalid Request'));
    }
  }

  @Stage('handleRequest')
  async handleRequest() {
    const transportService = (this.scope as Scope).transportService;
    const logger = (this.scope as Scope).logger.child('HandleStatelessHttpFlow');
    const { request, response } = this.rawInput;
    const { token, isAuthenticated, requestType } = this.state;

    logger.info(`handleRequest: using ${isAuthenticated ? 'authenticated' : 'anonymous'} stateless transport`);

    // Get or create the stateless transport
    // For anonymous: shared singleton transport
    // For authenticated: singleton per token
    const transport =
      isAuthenticated && token
        ? await transportService.getOrCreateAuthenticatedStatelessTransport('stateless-http', token, response)
        : await transportService.getOrCreateAnonymousStatelessTransport('stateless-http', response);

    // For stateless mode, inject the well-known session ID
    // This satisfies the MCP SDK's session header requirement while keeping requests stateless
    if (!request.headers['mcp-session-id']) {
      request.headers['mcp-session-id'] = '__stateless__';
      logger.verbose('handleRequest: injected __stateless__ session ID');
    }

    logger.verbose(`handleRequest: requestType=${requestType}, forwarding to transport`);

    try {
      if (requestType === 'initialize') {
        await transport.initialize(request, response);
      } else {
        await transport.handleRequest(request, response);
      }
    } catch (error) {
      logger.error('handleRequest: transport failed', {
        requestType,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
      throw error;
    }

    this.handled();
  }
}
