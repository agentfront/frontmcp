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
  normalizeEntryPrefix,
  normalizeScopeBase,
} from '../../common';
import { z } from 'zod';
import { Scope } from '../../scope';
import { createSessionId } from '../../auth/session/utils/session-id.utils';

export const plan = {
  pre: ['parseInput', 'router'],
  execute: ['onInitialize', 'onMessage', 'onElicitResult'],
  post: [],
  finalize: ['cleanup'],
} as const satisfies FlowPlan<string>;

export const stateSchema = z.object({
  token: z.string(),
  session: sessionIdSchema,
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
    let { session } = authorization;

    if (!session) {
      session = createSessionId('legacy-sse', token);
      request[ServerRequestTokens.auth].session = session;
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

    const { request, response } = this.rawInput;
    const { token, session } = this.state.required;
    const transport = await transportService.getTransporter('sse', token, session.id);
    if (!transport) {
      this.respond(httpRespond.rpcError('session not initialized'));
      return;
    }
    await transport.handleRequest(request, response);
    this.handled();
  }
}
