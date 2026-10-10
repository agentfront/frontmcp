// file: libs/sdk/src/prompt/flows/get-prompt.flow.ts

import { AuthorityDeniedError, resolveRequiredScopes } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';
import { GetPromptRequestSchema, GetPromptResultSchema, type AuthInfo } from '@frontmcp/protocol';

import { loadRemoteAppCapabilities } from '../../app/remote-capabilities.utils';
import { enforcePublicAccess, publicAccessFor } from '../../auth/public-access.utils';
import {
  buildPartitionContext,
  Flow,
  FlowBase,
  FlowControl,
  FlowHooksOf,
  type FlowPlan,
  type FlowRunOptions,
  type PromptContext,
  type PromptEntry,
  type ScopeEntry,
  type Token,
} from '../../common';
import { availabilityForCall, callSurfaceOf, entryUnavailableError } from '../../common/availability';
import { runOnSurface } from '../../context/call-surface';
import {
  InvalidInputError,
  InvalidMethodError,
  InvalidOutputError,
  isClientFacingError,
  PromptExecutionError,
  PromptNotFoundError,
} from '../../errors';
import { ResolvedEntries } from '../../flows/resolved-entries';
import { type EntryClassHooksJoin } from '../../hooks/entry-class-hooks';
import { hooksBoundTo } from '../../hooks/hooks.utils';
import { FlowContextProviders } from '../../provider/flow-context-providers';
import { appOwnerIdOf } from '../../utils/lineage.utils';

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
  // z.any() used because AuthInfo is a complex external type from @frontmcp/protocol
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
  pre: [
    'parseInput',
    'ensureRemoteCapabilities',
    'findPrompt',
    'checkPublicAccess',
    'checkEntryAuthorities',
    'createPromptContext',
  ],
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

/** Where the hooks a prompt class declares join a run: they run on the instance 'createPromptContext' builds. */
export const promptClassHooksJoin: EntryClassHooksJoin = { flow: name, plan, contextStage: 'createPromptContext' };
const { Stage } = FlowHooksOf<'prompts:get-prompt'>(name);

/** Prompts `resolveHookOwnerId` found, reused by the same run's `findPrompt`. */
const resolvedPrompts = new ResolvedEntries<PromptEntry>();

/**
 * The prompt a `prompts/get` names: by its name, or by its app-qualified name (`desk:summarize`),
 * which prompts/list hands out when names collide. `findPrompt` and the run's hook resolution use it,
 * so both resolve the same prompt.
 */
function findPromptForGet(prompts: ScopeEntry['prompts'], name: string): PromptEntry | undefined {
  return prompts.findByName(name) ?? prompts.getPrompts(true).find((entry) => entry.fullName === name);
}

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class GetPromptFlow extends FlowBase<typeof name> {
  static override async resolveHookOwnerId(rawInput: unknown, scope: ScopeEntry): Promise<string | undefined> {
    const promptName = (rawInput as { request?: { params?: { name?: unknown } } } | undefined)?.request?.params?.name;
    if (typeof promptName !== 'string') return undefined;
    let prompt = findPromptForGet(scope.prompts, promptName);
    if (!prompt) {
      await loadRemoteAppCapabilities(scope);
      prompt = findPromptForGet(scope.prompts, promptName);
    }
    if (!prompt) return undefined;
    resolvedPrompts.remember(rawInput, promptName, prompt);
    return appOwnerIdOf(scope.prompts.lineageOf(prompt) ?? [], prompt.owner);
  }

  /** The class of the prompt the request names, whose `static` hooks run from `parseInput` on (#701). */
  static override resolveHookEntryClass(rawInput: unknown, scope: ScopeEntry): Token | undefined {
    const promptName = (rawInput as { request?: { params?: { name?: unknown } } } | undefined)?.request?.params?.name;
    if (typeof promptName !== 'string') return undefined;
    return (resolvedPrompts.peek(rawInput, promptName) ?? findPromptForGet(scope.prompts, promptName))?.record.provide;
  }

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

    const prompt = resolvedPrompts.take(this.rawInput, name) ?? findPromptForGet(this.scope.prompts, name);

    if (!prompt) {
      this.logger.warn(`findPrompt: prompt "${name}" not found`);
      throw new PromptNotFoundError(name);
    }

    // `availableWhen` gates prompts/get, not only the listing: a surface the prompt isn't offered on
    // answers like an unknown prompt, and a process-wide axis answers EntryUnavailableError.
    const { availableWhen } = prompt.metadata;
    const callSurface = callSurfaceOf(this.input.ctx);
    const availability = availabilityForCall(availableWhen, callSurface);
    if (availability === 'not-offered') {
      this.logger.warn(`findPrompt: prompt "${name}" is not offered on surface "${callSurface}"`);
      throw new PromptNotFoundError(name);
    }
    if (availability === 'unavailable') {
      this.logger.warn(`findPrompt: prompt "${name}" is unavailable in this environment`);
      throw entryUnavailableError('Prompt', name, availableWhen, callSurface);
    }

    // Store prompt owner ID in state for hook filtering during execution
    this.state.set('promptOwnerId', prompt.owner?.id);

    this.logger = this.logger.child(`GetPromptFlow(${name})`);
    this.state.set('prompt', prompt);
    this.logger.info(`findPrompt: prompt "${prompt.name}" found`);
    this.logger.verbose('findPrompt:done');
  }

  /**
   * An anonymous caller may get only the prompts `publicAccess` lists, within its rate limit. An agent's
   * model reading one of the agent's own prompts (`agentPrivateCall`) is not checked: the caller's call
   * to the agent was.
   */
  @Stage('checkPublicAccess')
  async checkPublicAccess() {
    const { prompt, authInfo } = this.state;
    const publicAccess = publicAccessFor(this.scope.auth?.options, authInfo);
    const callerCtx = this.input.ctx as { agentPrivateCall?: boolean } | undefined;
    if (!prompt || !publicAccess || callerCtx?.agentPrivateCall) return;
    await enforcePublicAccess(
      publicAccess,
      { kind: 'prompt', names: [prompt.fullName || prompt.name, prompt.name] },
      this.scope.publicAccessGuard,
      buildPartitionContext(this.tryGetContext()),
    );
  }

  /**
   * Check entry-level authorities (RBAC/ABAC/ReBAC) declared in prompt metadata.
   * Hookable: developers can use Will/Did/Around on 'checkEntryAuthorities'.
   */
  @Stage('checkEntryAuthorities')
  async checkEntryAuthorities() {
    this.logger.verbose('checkEntryAuthorities:start');
    const engine = this.scope.authoritiesEngine;
    const ctxBuilder = this.scope.authoritiesContextBuilder;
    if (!engine || !ctxBuilder) return;

    const prompt = this.state.prompt;
    if (!prompt) return;

    const metadata = prompt.metadata as unknown as Record<string, unknown>;
    const authorities = metadata['authorities'];
    if (!authorities) {
      this.logger.verbose('checkEntryAuthorities:skip (no authorities)');
      return;
    }

    const authInfo = (this.state.authInfo ?? {}) as Record<string, unknown>;
    const evalCtx = ctxBuilder.build(authInfo);
    const result = await engine.evaluate(authorities as import('@frontmcp/auth').AuthoritiesMetadata, evalCtx);

    if (!result.granted) {
      let requiredScopes: string[] | undefined;
      const scopeMapping = this.scope.authoritiesScopeMapping;
      if (scopeMapping && result.denial) {
        requiredScopes = resolveRequiredScopes(
          result.denial,
          scopeMapping,
          authorities as import('@frontmcp/auth').AuthoritiesMetadata,
        );
      }

      throw new AuthorityDeniedError({
        entryType: 'Prompt',
        entryName: prompt.fullName || prompt.name,
        deniedBy: result.deniedBy ?? 'policy denied',
        denial: result.denial,
        requiredScopes,
      });
    }
    this.logger.verbose('checkEntryAuthorities:done');
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

      // The prompt's own provider hierarchy wins over the scope-level instances in the flow deps.
      const sessionKey = authInfo?.sessionId ?? 'anonymous';
      const promptViews = await prompt.providers.buildViews(sessionKey, new Map(this.deps), this.scope.providers);
      const contextProviders = new FlowContextProviders(prompt.providers, promptViews.context);
      const context = prompt.create(parsedArgs, { ...ctx, contextProviders });
      // `authorities.pipes` may be async: run them before any hook or execute() reads `this.auth`.
      await context.loadAuthContext();
      this.appendContextHooks(hooksBoundTo(this.scope.hooks.getClsHooks(prompt.record.provide), context));
      context.mark('createPromptContext');
      this.state.set('promptContext', context);
      this.logger.verbose('createPromptContext:done');
    } catch (error) {
      if (error instanceof FlowControl || isClientFacingError(error)) throw error;
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
      // Use cached parsed arguments from createPromptContext stage. What the prompt does for the
      // caller is judged for this call's surface (`getCallSurface()`), as in a tool or resource read.
      promptContext.output = await runOnSurface(callSurfaceOf(this.input.ctx), async () =>
        promptContext.execute(parsedArgs),
      );
      this.logger.verbose('execute:done');
    } catch (error) {
      // `this.respond(value)` set the output and ends the prompt, which validateOutput and finalize treat as returned
      if (error instanceof FlowControl && error.type === 'respond') return;
      if (error instanceof FlowControl || isClientFacingError(error)) throw error;
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
