// file: libs/sdk/src/resource/flows/subscribe-resource.flow.ts

import { z } from '@frontmcp/lazy-zod';
import { EmptyResultSchema, SubscribeRequestSchema } from '@frontmcp/protocol';

import { loadRemoteAppCapabilities } from '../../app/remote-capabilities.utils';
import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { availabilityForCall, callSurfaceOf, entryUnavailableError } from '../../common/availability';
import { InvalidInputError, InvalidMethodError, ResourceNotFoundError } from '../../errors';
import { isUIResourceUri } from '../../tool/ui';
import { mcpRequestSessionId } from '../../transport/mcp-handlers/mcp-surface';

const inputSchema = z.object({
  request: SubscribeRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = EmptyResultSchema;

const stateSchema = z.object({
  input: z.object({
    uri: z.string().min(1),
  }),
  sessionId: z.string().optional(),
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
    let params: z.infer<typeof SubscribeRequestSchema>['params'];
    let ctx: unknown;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
      ctx = inputData.ctx;
    } catch (e) {
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'resources/subscribe') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'resources/subscribe');
    }

    // The session the subscription belongs to: a request without one is answered without subscribing
    const sessionId = mcpRequestSessionId(ctx);
    this.state.set({ input: params, sessionId });
    this.logger.verbose('parseInput:done');
  }

  /** Refuse what resources/read refuses, with the same error, so a subscription can't reveal a resource it can't read. */
  @Stage('validateResource')
  async validateResource() {
    this.logger.verbose('validateResource:start');

    const { uri } = this.state.required.input;
    // `ui://` widget URIs are served from the tool UI registry and carry no `availableWhen` of their own
    if (isUIResourceUri(uri)) return;

    let match = this.scope.resources.findResourceForUri(uri);
    if (!match) {
      // Remote apps list their resources lazily, as resources/read accounts for
      await loadRemoteAppCapabilities(this.scope);
      match = this.scope.resources.findResourceForUri(uri);
    }
    if (!match) throw new ResourceNotFoundError(uri);

    const { availableWhen } = match.instance.metadata;
    const surface = callSurfaceOf(this.input.ctx);
    const availability = availabilityForCall(availableWhen, surface);
    if (availability === 'not-offered') throw new ResourceNotFoundError(uri);
    if (availability === 'unavailable') {
      throw entryUnavailableError(
        match.instance.isTemplate ? 'ResourceTemplate' : 'Resource',
        uri,
        availableWhen,
        surface,
      );
    }

    this.logger.verbose('validateResource:done');
  }

  @Stage('subscribe')
  async subscribe() {
    this.logger.verbose('subscribe:start');
    const { uri } = this.state.required.input;
    const { sessionId } = this.state;
    if (!sessionId) {
      this.logger.warn('subscribe: no session ID in the request context');
      return;
    }

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
