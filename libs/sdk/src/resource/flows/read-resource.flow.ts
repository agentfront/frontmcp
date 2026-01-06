// file: libs/sdk/src/resource/flows/read-resource.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, ResourceContext, ResourceEntry } from '../../common';
import { z } from 'zod';
import { ReadResourceRequestSchema, ReadResourceResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidMethodError,
  ResourceNotFoundError,
  InvalidInputError,
  InvalidOutputError,
  ResourceReadError,
} from '../../errors';
import { isUIResourceUri, handleUIResourceRead } from '../../tool/ui';
import { Scope } from '../../scope';
import { FlowContextProviders } from '../../provider/flow-context-providers';

const inputSchema = z.object({
  request: ReadResourceRequestSchema,
  // z.any() used because ctx is the MCP SDK's ResourceReadExtra type which varies by SDK version
  ctx: z.any(),
});

const outputSchema = ReadResourceResultSchema;

const stateSchema = z.object({
  input: z.object({
    uri: z.string().min(1),
  }),
  // z.any() used because AuthInfo is a complex external type from @modelcontextprotocol/sdk
  authInfo: z.any().optional() as z.ZodType<AuthInfo>,
  params: z.record(z.string(), z.string()).default({}), // URI template parameters
  // z.any() used because ResourceEntry is a complex abstract class type
  resource: z.any() as z.ZodType<ResourceEntry>,
  // z.any() used because ResourceContext is a complex abstract class type
  resourceContext: z.any() as z.ZodType<ResourceContext>,
  // z.any() used because resource output type varies by resource implementation
  rawOutput: z.any().optional(),
  output: outputSchema,
  // Resource owner ID for hook filtering (stored in state instead of mutating rawInput)
  resourceOwnerId: z.string().optional(),
  // Session ID for platform type detection
  sessionId: z.string().optional(),
  // Flag indicating this is a UI resource (ui:// scheme)
  isUIResource: z.boolean().default(false),
  // Pre-resolved UI resource result (if isUIResource is true)
  uiResourceResult: outputSchema.optional(),
});

const plan = {
  pre: ['parseInput', 'findResource', 'createResourceContext'],
  execute: ['execute', 'validateOutput'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'resources:read-resource': FlowRunOptions<
      ReadResourceFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'resources:read-resource' as const;
const { Stage } = FlowHooksOf<'resources:read-resource'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ReadResourceFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ReadResourceFlow');

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
      throw new InvalidInputError('Invalid Input', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'resources/read') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'resources/read');
    }

    // Extract sessionId from context for platform type detection
    const sessionId = (ctx as Record<string, unknown> | undefined)?.['sessionId'];

    this.state.set({
      input: params,
      authInfo: ctx.authInfo,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    });
    this.logger.verbose('parseInput:done');
  }

  @Stage('findResource')
  async findResource() {
    this.logger.verbose('findResource:start');

    const { uri } = this.state.required.input;
    this.logger.info(`findResource: looking for resource with URI "${uri}"`);

    // Check for UI resource URIs (ui://...) first
    if (isUIResourceUri(uri)) {
      this.logger.info(`findResource: detected UI resource URI "${uri}"`);

      // Get the ToolUIRegistry from the scope
      const scope = this.scope as Scope;

      // Get platform type: first check sessionIdPayload (detected from user-agent),
      // then fall back to notification service (detected from MCP clientInfo)
      const { sessionId, authInfo } = this.state;
      const platformType =
        authInfo?.sessionIdPayload?.platformType ??
        (sessionId ? scope.notifications.getPlatformType(sessionId) : undefined);

      this.logger.verbose(`findResource: platform type for session: ${platformType ?? 'unknown'}`);

      const uiResult = handleUIResourceRead(uri, scope.toolUI, platformType);

      if (uiResult.handled) {
        if (uiResult.error) {
          this.logger.warn(`findResource: UI resource error - ${uiResult.error}`);
          throw new ResourceNotFoundError(uri);
        }

        // Store the UI resource result and mark as UI resource
        this.state.set('isUIResource', true);
        this.state.set('uiResourceResult', uiResult.result);
        this.logger.info(`findResource: UI resource "${uri}" resolved from cache`);
        this.logger.verbose('findResource:done');
        return;
      }
    }

    // Try to find a resource that matches this URI
    // First try exact URI match, then template matching
    const match = this.scope.resources.findResourceForUri(uri);

    if (!match) {
      this.logger.warn(`findResource: resource for URI "${uri}" not found`);
      throw new ResourceNotFoundError(uri);
    }

    // Store resource owner ID in flow state for hook filtering
    if (match.instance.owner) {
      this.state.set('resourceOwnerId', match.instance.owner.id);
    }

    this.logger = this.logger.child(`ReadResourceFlow(${uri})`);
    this.state.set('resource', match.instance);
    this.state.set('params', match.params);
    this.logger.info(`findResource: resource "${match.instance.name}" found (template: ${match.instance.isTemplate})`);
    this.logger.verbose('findResource:done');
  }

  @Stage('createResourceContext')
  async createResourceContext() {
    this.logger.verbose('createResourceContext:start');

    // Skip for UI resources - they're already resolved
    if (this.state.isUIResource) {
      this.logger.verbose('createResourceContext: skipping for UI resource');
      return;
    }

    const { ctx } = this.input;
    const { resource, input, params } = this.state.required;

    try {
      // Create context-aware providers that include scoped providers from plugins
      const contextProviders = new FlowContextProviders(this.scope.providers, this.deps);
      const context = resource.create(input.uri, params, { ...ctx, contextProviders });
      const resourceHooks = this.scope.hooks.getClsHooks(resource.record.provide).map((hook) => {
        hook.run = async () => {
          return context[hook.metadata.method]();
        };
        return hook;
      });

      this.appendContextHooks(resourceHooks);
      context.mark('createResourceContext');
      this.state.set('resourceContext', context);
      this.logger.verbose('createResourceContext:done');
    } catch (error) {
      this.logger.error('createResourceContext: failed to create context', error);
      throw new ResourceReadError(input.uri, error instanceof Error ? error : undefined);
    }
  }

  @Stage('execute')
  async execute() {
    this.logger.verbose('execute:start');

    // Skip for UI resources - they're already resolved
    if (this.state.isUIResource) {
      this.logger.verbose('execute: skipping for UI resource');
      return;
    }

    const resourceContext = this.state.resourceContext;
    const { input, params } = this.state.required;

    if (!resourceContext) {
      this.logger.warn('execute: resourceContext not found, skipping execution');
      return;
    }
    resourceContext.mark('execute');

    try {
      resourceContext.output = await resourceContext.execute(input.uri, params);
      this.logger.verbose('execute:done');
    } catch (error) {
      this.logger.error('execute: resource read failed', error);
      throw new ResourceReadError(input.uri, error instanceof Error ? error : undefined);
    }
  }

  @Stage('validateOutput')
  async validateOutput() {
    this.logger.verbose('validateOutput:start');

    // Skip for UI resources - they're already resolved
    if (this.state.isUIResource) {
      this.logger.verbose('validateOutput: skipping for UI resource');
      return;
    }

    const { resourceContext } = this.state;
    if (!resourceContext) {
      this.logger.warn('validateOutput: resourceContext not found, skipping validation');
      return;
    }
    resourceContext.mark('validateOutput');

    // Store the RAW output for plugins to inspect
    this.state.set('rawOutput', resourceContext.output);

    this.logger.verbose('validateOutput:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');

    // Handle UI resources - return the pre-resolved result
    if (this.state.isUIResource) {
      const { uiResourceResult, input } = this.state;

      if (!uiResourceResult) {
        this.logger.error('finalize: UI resource result not found in state');
        throw new ResourceReadError(input?.uri || 'unknown', new Error('UI resource result not found'));
      }

      this.respond(uiResourceResult);
      this.logger.verbose('finalize:done (UI resource)');
      return;
    }

    const { resource, rawOutput, input } = this.state;

    if (!resource) {
      this.logger.error('finalize: resource not found in state');
      throw new ResourceReadError('unknown', new Error('Resource not found in state'));
    }

    if (rawOutput === undefined) {
      this.logger.error('finalize: resource output not found in state');
      throw new ResourceReadError(input?.uri || 'unknown', new Error('Resource output not found'));
    }

    // Parse and construct the MCP-compliant output using safeParseOutput
    const parseResult = resource.safeParseOutput(rawOutput);

    if (!parseResult.success) {
      this.logger.error('finalize: output validation failed', {
        resource: resource.metadata.name,
        errors: parseResult.error,
      });

      throw new InvalidOutputError();
    }

    // Respond with the properly formatted MCP result
    this.respond(parseResult.data);
    this.logger.verbose('finalize:done');
  }
}
