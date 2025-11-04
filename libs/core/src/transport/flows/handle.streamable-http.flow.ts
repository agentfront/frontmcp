import {
  Flow, httpInputSchema, FlowRunOptions, httpOutputSchema, FlowPlan,
  FlowBase, FlowHooksOf,
  authorizationSchema, sessionIdSchema, httpRespond, ServerRequestTokens, Authorization,
} from '@frontmcp/sdk';
import { z } from 'zod';
import { ElicitResultSchema, InitializeRequestSchema, RequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Scope } from '../../scope';
import { createSessionId } from '../../auth/session/utils/session-id.utils';

export const plan = {
  pre: [
    'parseInput',
    'router',
  ],
  execute: [
    'onInitialize',
    'onMessage',
    'onElicitResult',
  ],
  post: [],
  finalize: [
    'cleanup',
  ],
} as const satisfies FlowPlan<string>;


export const stateSchema = z.object({
  token: z.string(),
  session: sessionIdSchema,
  requestType: z.enum(['initialize', 'message', 'elicitResult']).optional(),
});

const name = 'handle:streamable-http' as const;
const { Stage } = FlowHooksOf(name);


declare global {
  export interface ExtendFlows {
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
  access: 'authorized',
  inputSchema: httpInputSchema,
  outputSchema: httpOutputSchema,
  plan,
})
export default class HandleStreamableHttpFlow extends FlowBase<typeof name> {

  @Stage('parseInput')
  async paseInput() {
    const { request } = this.rawInput;

    let { token, session } = request[ServerRequestTokens.auth] as Authorization;

    if (!session) {
      session = createSessionId('streamable-http', token);
      request[ServerRequestTokens.auth].session = session;
    }
    this.state.set(stateSchema.parse({ token, session }));
  }

  @Stage('router')
  async router() {
    const { request } = this.rawInput;

    if (InitializeRequestSchema.safeParse(request.body).success) {
      this.state.set('requestType', 'initialize');
    } else if (ElicitResultSchema.safeParse(request.body).success) {
      this.state.set('requestType', 'elicitResult');
    } else if (RequestSchema.safeParse(request.body).success) {
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

  }

  @Stage('onMessage', {
    filter: ({ state: { requestType } }) => requestType === 'message',
  })
  async onMessage() {
    const transportService = (this.scope as Scope).transportService;

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;
    const transport = await transportService.getTransporter('streamable-http', token, session.id);
    if (!transport) {
      this.respond(httpRespond.rpcError('session not initialized'));
      return;
    }
    await transport.handleRequest(request, response);
    this.handled();
  }


}
