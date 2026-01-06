// file: libs/sdk/src/prompt/flows/get-prompt.flow.ts

import { Flow, FlowBase, FlowHooksOf, FlowPlan, FlowRunOptions, PromptContext, PromptEntry } from '../../common';
import { z } from 'zod';
import { GetPromptRequestSchema, GetPromptResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  InvalidMethodError,
  PromptNotFoundError,
  InvalidInputError,
  InvalidOutputError,
  PromptExecutionError,
} from '../../errors';
import { FlowContextProviders } from '../../provider/flow-context-providers';

const inputSchema = z.object({
  request: GetPromptRequestSchema,
  // z.any() used because ctx is the MCP SDK's PromptGetExtra type which varies by SDK version
  ctx: z.any(),
});

const outputSchema = GetPromptResultSchema;

const stateSchema = z.object({
  input: z.object({
    name: z.string().min(1),
    arguments: z.record(z.string(), z.string()).optional(),
  }),
  // Prompt owner ID for hook filtering during execution
  promptOwnerId: z.string().optional(),
  // z.any() used because AuthInfo is a complex external type from @modelcontextprotocol/sdk
  authInfo: z.any().optional() as z.ZodType<AuthInfo>,
  // z.any() used because PromptEntry is a complex abstract class type
  prompt: z.any() as z.ZodType<PromptEntry>,
  // Cached parsed arguments to avoid parsing twice (once in createPromptContext, once in execute)
  parsedArgs: z.record(z.string(), z.string()).optional(),
  // z.any() used because PromptContext is a complex abstract class type
  promptContext: z.any() as z.ZodType<PromptContext>,
  // z.any() used because prompt output type varies by prompt implementation
  rawOutput: z.any().optional(),
  output: outputSchema,
});

const plan = {
  pre: ['parseInput', 'ensureRemoteCapabilities', 'findPrompt', 'createPromptContext'],
  execute: ['execute', 'validateOutput'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'prompts:get-prompt': FlowRunOptions<
      GetPromptFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'prompts:get-prompt' as const;
const { Stage } = FlowHooksOf<'prompts:get-prompt'>(name);

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class GetPromptFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('GetPromptFlow');

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

    if (method !== 'prompts/get') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'prompts/get');
    }

    this.state.set({
      input: {
        name: params.name,
        arguments: params.arguments,
      },
      authInfo: ctx.authInfo,
    });
    this.logger.verbose('parseInput:done');
  }

  /**
   * Ensure remote app capabilities are loaded before looking up prompts.
   * Remote apps use lazy capability discovery - this triggers the loading.
   * Uses provider registry to find all remote apps across all app registries.
   */
  @Stage('ensureRemoteCapabilities')
  async ensureRemoteCapabilities() {
    this.logger.verbose('ensureRemoteCapabilities:start');

    // Get all apps from all app registries (same approach as PromptRegistry.initialize)
    // This finds remote apps that may be in parent scopes
    const appRegistries = this.scope.providers.getRegistries('AppRegistry');
    const remoteApps: Array<{ id: string; ensureCapabilitiesLoaded?: () => Promise<void> }> = [];

    for (const appRegistry of appRegistries) {
      const apps = appRegistry.getApps();
      for (const app of apps) {
        if (app.isRemote) {
          remoteApps.push(app);
        }
      }
    }

    this.logger.verbose(
      `ensureRemoteCapabilities: found ${remoteApps.length} remote app(s) across ${appRegistries.length} registries`,
    );

    if (remoteApps.length === 0) {
      this.logger.verbose('ensureRemoteCapabilities:skip (no remote apps)');
      return;
    }

    // Trigger capability loading for all remote apps in parallel
    const loadPromises = remoteApps.map(async (app) => {
      // Check if app has ensureCapabilitiesLoaded method (remote apps do)
      if ('ensureCapabilitiesLoaded' in app && typeof app.ensureCapabilitiesLoaded === 'function') {
        try {
          await app.ensureCapabilitiesLoaded();
        } catch (error) {
          this.logger.warn(`Failed to load capabilities for remote app ${app.id}: ${(error as Error).message}`);
        }
      }
    });

    await Promise.all(loadPromises);
    this.logger.verbose('ensureRemoteCapabilities:done');
  }

  @Stage('findPrompt')
  async findPrompt() {
    this.logger.verbose('findPrompt:start');

    const { name } = this.state.required.input;
    this.logger.info(`findPrompt: looking for prompt with name "${name}"`);

    // Try to find a prompt that matches this name
    const prompt = this.scope.prompts.findByName(name);

    if (!prompt) {
      this.logger.warn(`findPrompt: prompt "${name}" not found`);
      throw new PromptNotFoundError(name);
    }

    // Store prompt owner ID in state for hook filtering during execution
    this.state.set('promptOwnerId', prompt.owner?.id);

    this.logger = this.logger.child(`GetPromptFlow(${name})`);
    this.state.set('prompt', prompt);
    this.logger.info(`findPrompt: prompt "${prompt.name}" found`);
    this.logger.verbose('findPrompt:done');
  }

  @Stage('createPromptContext')
  async createPromptContext() {
    this.logger.verbose('createPromptContext:start');
    const { ctx } = this.input;
    const { prompt, input } = this.state.required;
    // authInfo is optional - access separately to avoid "required" throwing
    const authInfo = this.state.authInfo;

    try {
      // Parse and validate arguments, cache for reuse in execute stage
      const parsedArgs = prompt.parseArguments(input.arguments);
      this.state.set('parsedArgs', parsedArgs);

      // Build context-scoped providers from the prompt's provider registry (app-level).
      // This ensures CONTEXT-scoped providers registered at the app level are available.
      const sessionKey = authInfo?.sessionId ?? 'anonymous';
      const promptViews = await prompt.providers.buildViews(sessionKey, new Map(this.deps));

      // Merge prompt's context providers with flow's context deps
      const mergedContextDeps = new Map(this.deps);
      for (const [token, instance] of promptViews.context) {
        if (!mergedContextDeps.has(token)) {
          mergedContextDeps.set(token, instance);
        }
      }

      // Create context-aware providers that include scoped providers from both
      // the scope (via flow deps) and the prompt's app (via promptViews).
      const contextProviders = new FlowContextProviders(prompt.providers, mergedContextDeps);
      const context = prompt.create(parsedArgs, { ...ctx, contextProviders });
      const promptHooks = this.scope.hooks.getClsHooks(prompt.record.provide).map((hook) => {
        hook.run = async () => {
          return context[hook.metadata.method]();
        };
        return hook;
      });

      this.appendContextHooks(promptHooks);
      context.mark('createPromptContext');
      this.state.set('promptContext', context);
      this.logger.verbose('createPromptContext:done');
    } catch (error) {
      this.logger.error('createPromptContext: failed to create context', error);
      throw new PromptExecutionError(input.name, error instanceof Error ? error : undefined);
    }
  }

  @Stage('execute')
  async execute() {
    this.logger.verbose('execute:start');
    const promptContext = this.state.promptContext;
    const { input, parsedArgs } = this.state.required;

    if (!promptContext) {
      this.logger.warn('execute: promptContext not found, skipping execution');
      return;
    }
    promptContext.mark('execute');

    try {
      // Use cached parsed arguments from createPromptContext stage
      promptContext.output = await promptContext.execute(parsedArgs);
      this.logger.verbose('execute:done');
    } catch (error) {
      this.logger.error('execute: prompt execution failed', error);
      throw new PromptExecutionError(input.name, error instanceof Error ? error : undefined);
    }
  }

  @Stage('validateOutput')
  async validateOutput() {
    this.logger.verbose('validateOutput:start');
    const { promptContext } = this.state;
    if (!promptContext) {
      this.logger.warn('validateOutput: promptContext not found, skipping validation');
      return;
    }
    promptContext.mark('validateOutput');

    // Store the RAW output for plugins to inspect
    this.state.set('rawOutput', promptContext.output);

    this.logger.verbose('validateOutput:done');
  }

  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize:start');
    const { prompt, rawOutput, input } = this.state;

    if (!prompt) {
      this.logger.error('finalize: prompt not found in state');
      throw new PromptExecutionError('unknown', new Error('Prompt not found in state'));
    }

    if (rawOutput === undefined) {
      this.logger.error('finalize: prompt output not found in state');
      throw new PromptExecutionError(input?.name || 'unknown', new Error('Prompt output not found'));
    }

    // Parse and construct the MCP-compliant output using safeParseOutput
    const parseResult = prompt.safeParseOutput(rawOutput);

    if (!parseResult.success) {
      this.logger.error('finalize: output validation failed', {
        prompt: prompt.metadata.name,
        errors: parseResult.error,
      });

      throw new InvalidOutputError();
    }

    // Respond with the properly formatted MCP result
    this.respond(parseResult.data);
    this.logger.verbose('finalize:done');
  }
}
