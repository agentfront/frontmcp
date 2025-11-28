// file: libs/sdk/src/resource/flows/subscribe-resource.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions } from '../../common';
import { z } from 'zod';
import { SubscribeRequestSchema, EmptyResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError, ResourceNotFoundError } from '../../errors';

const inputSchema = z.object({
  request: SubscribeRequestSchema,
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
  pre: ['parseInput', 'validateResource'],
  execute: ['subscribe'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'resources:subscribe': FlowRunOptions<
      SubscribeResourceFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'resources:subscribe' as const;
const { Stage } = FlowHooksOf<'resources:subscribe'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class SubscribeResourceFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('SubscribeResourceFlow');

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

    if (method !== 'resources/subscribe') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'resources/subscribe');
    }

    // Get session ID from context - required for subscription tracking
    const sessionId = ctx?.sessionId;
    if (!sessionId || typeof sessionId !== 'string') {
      this.logger.warn('parseInput: sessionId not found in context');
      throw new InvalidInputError('Session ID is required for resource subscriptions');
    }

    this.state.set({ input: params, sessionId });
    this.logger.verbose('parseInput:done');
  }

  @Stage('validateResource')
  async validateResource() {
    this.logger.verbose('validateResource:start');

    const { uri } = this.state.required.input;
    this.logger.info(`validateResource: checking resource with URI "${uri}"`);

    // Verify the resource exists before allowing subscription
    const match = this.scope.resources.findResourceForUri(uri);

    if (!match) {
      this.logger.warn(`validateResource: resource for URI "${uri}" not found`);
      throw new ResourceNotFoundError(uri);
    }

    this.logger.verbose('validateResource:done');
  }

  @Stage('subscribe')
  async subscribe() {
    this.logger.verbose('subscribe:start');
    const { uri } = this.state.required.input;
    const { sessionId } = this.state.required;

    const isNew = this.scope.notifications.subscribeResource(sessionId, uri);

    if (isNew) {
      this.logger.info(`subscribe: session subscribed to resource ${uri}`);
    } else {
      this.logger.verbose(`subscribe: session already subscribed to resource ${uri}`);
    }

    this.logger.verbose('subscribe:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    // Per MCP spec, resources/subscribe returns an empty result
    this.respond({});
    this.logger.verbose('finalize:done');
  }
}
