// file: libs/sdk/src/resource/flows/subscribe-resource.flow.ts

import { AuthorityDeniedError, resolveRequiredScopes, type AuthoritiesMetadata } from '@frontmcp/auth';
import { internalZ as z } from '@frontmcp/lazy-zod';
import { EmptyResultSchema, SubscribeRequestSchema } from '@frontmcp/protocol';

import { loadRemoteAppCapabilities } from '../../app/remote-capabilities.utils';
import { Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions, type ResourceEntry } from '../../common';
import { availabilityForCall, callSurfaceOf, entryUnavailableError } from '../../common/availability';
import { InvalidInputError, InvalidMethodError, ResourceNotFoundError } from '../../errors';
import { assertEntryEnabled } from '../../surface';
import { isUIResourceUri } from '../../tool/ui/ui-shared';
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
  // z.any() used because ResourceEntry is a complex abstract class type
  resource: z.any().optional() as z.ZodType<ResourceEntry | undefined>,
  output: outputSchema,
});

const plan = {
  pre: ['parseInput', 'validateResource', 'checkEntryAuthorities'],
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
    const entryType = match.instance.isTemplate ? 'ResourceTemplate' : 'Resource';
    if (availability === 'unavailable') throw entryUnavailableError(entryType, uri, availableWhen, surface);
    await assertEntryEnabled(entryType, uri, match.instance.metadata.enabled, this.tryGetContext(), this.logger);
    this.state.set('resource', match.instance);

    this.logger.verbose('validateResource:done');
  }

  /** The resource's `authorities`, checked as `resources/read` checks them, so a refused reader is never told of a change. */
  @Stage('checkEntryAuthorities')
  async checkEntryAuthorities() {
    const engine = this.scope.authoritiesEngine;
    const ctxBuilder = this.scope.authoritiesContextBuilder;
    const { resource } = this.state;
    if (!engine || !ctxBuilder || !resource) return;

    const authorities = (resource.metadata as unknown as Record<string, unknown>)['authorities'] as
      | AuthoritiesMetadata
      | undefined;
    if (!authorities) return;

    const authInfo = (this.input.ctx as { authInfo?: Record<string, unknown> } | undefined)?.authInfo ?? {};
    const result = await engine.evaluate(authorities, ctxBuilder.build(authInfo));
    if (result.granted) return;

    const scopeMapping = this.scope.authoritiesScopeMapping;
    throw new AuthorityDeniedError({
      entryType: 'Resource',
      entryName: resource.fullName || resource.name,
      deniedBy: result.deniedBy ?? 'policy denied',
      denial: result.denial,
      requiredScopes:
        scopeMapping && result.denial ? resolveRequiredScopes(result.denial, scopeMapping, authorities) : undefined,
    });
  }

  @Stage('subscribe')
  async subscribe() {
    this.logger.verbose('subscribe:start');
    const { uri } = this.state.required.input;
    const { sessionId } = this.state;
    // A 2026-07-28 `subscriptions/listen` stream checks its URIs with this flow and holds the subscriptions itself
    if (!sessionId) {
      this.logger.verbose('subscribe: no session ID in the request context');
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
