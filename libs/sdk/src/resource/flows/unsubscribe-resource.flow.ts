// file: libs/sdk/src/resource/flows/unsubscribe-resource.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import { UnsubscribeRequestSchema, EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError } from '../../errors';

const inputSchema = z.object({
  request: UnsubscribeRequestSchema,
  ctx: z.any(),
});

const outputSchema = EmptyResultSchema;

const stateSchema = z.object({
  input: z.object({
    uri: z.string().min(1),
  }),
  sessionId: z.string(),
  output: outputSchema,
});

const plan = {
  pre: ['parseInput'],
  execute: ['unsubscribe'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'resources:unsubscribe': FlowRunOptions<
      UnsubscribeResourceFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'resources:unsubscribe' as const;
const { Stage } = FlowHooksOf<'resources:unsubscribe'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class UnsubscribeResourceFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('UnsubscribeResourceFlow');

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    let params: any;
    let ctx: any;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
      ctx = inputData.ctx;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.errors : undefined);
    }

    if (method !== 'resources/unsubscribe') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'resources/unsubscribe');
    }

    // Get session ID from context - required for subscription tracking
    const sessionId = ctx?.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      this.logger.warn('parseInput: sessionId not found in context');
      throw new InvalidInputError('Session ID is required for resource unsubscriptions');
    }

    this.state.set({ input: params, sessionId });
    this.logger.verbose('parseInput:done');
  }

  @Stage('unsubscribe')
  async unsubscribe() {
    this.logger.verbose('unsubscribe:start');
    const { uri } = this.state.required.input;
    const { sessionId } = this.state.required;

    // Per MCP spec, unsubscribe should succeed even if the resource doesn't exist
    // or the session wasn't subscribed. We just silently succeed.
    const wasSubscribed = this.scope.notifications.unsubscribeResource(sessionId, uri);

    if (wasSubscribed) {
      this.logger.info(`unsubscribe: session unsubscribed from resource ${uri}`);
    } else {
      this.logger.verbose(`unsubscribe: session was not subscribed to resource ${uri}`);
    }

    this.logger.verbose('unsubscribe:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    // Per MCP spec, resources/unsubscribe returns an empty result
    this.respond({});
    this.logger.verbose('finalize:done');
  }
}
