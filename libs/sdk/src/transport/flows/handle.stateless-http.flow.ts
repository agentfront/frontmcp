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

    // Check if we have auth info
    const auth = request[ServerRequestTokens.auth] as Authorization | undefined;
    const token = auth?.token;
    const isAuthenticated = !!token && token.length > 0;

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
    const body = request.body as { method?: string } | undefined;
    const method = body?.method;

    // Use method-based detection for routing (more permissive than strict schema)
    // The actual schema validation happens in the MCP SDK's transport layer
    if (method === 'initialize') {
      this.state.set('requestType', 'initialize');
    } else if (method && RequestSchema.safeParse(request.body).success) {
      this.state.set('requestType', 'message');
    } else {
      this.respond(httpRespond.rpcError('Invalid Request'));
    }
  }

  @Stage('handleRequest')
  async handleRequest() {
    const transportService = (this.scope as Scope).transportService;
    const { request, response } = this.rawInput;
    // Use state directly for optional fields (token can be undefined)
    const { token, isAuthenticated, requestType } = this.state;

    // Get or create the stateless transport
    // For anonymous: shared singleton transport
    // For authenticated: singleton per token
    const transport =
      isAuthenticated && token
        ? await transportService.getOrCreateAuthenticatedStatelessTransport('stateless-http', token, response)
        : await transportService.getOrCreateAnonymousStatelessTransport('stateless-http', response);

    if (requestType === 'initialize') {
      // For stateless mode, initialize just returns success
      // The transport is shared, so we don't need session-specific setup
      await transport.initialize(request, response);
    } else {
      // Handle message requests
      await transport.handleRequest(request, response);
    }

    this.handled();
  }
}
