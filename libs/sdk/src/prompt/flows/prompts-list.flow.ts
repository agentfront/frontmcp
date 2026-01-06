// file: libs/sdk/src/prompt/flows/prompts-list.flow.ts

import { Flow, FlowBase, FlowControl, FlowHooksOf, FlowPlan, FlowRunOptions, PromptEntry } from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { ListPromptsRequestSchema, ListPromptsResultSchema, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError } from '../../errors';

const inputSchema = z.object({
  request: ListPromptsRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = ListPromptsResultSchema;

const stateSchema = z.object({
  cursor: z.string().optional(),
  prompts: z.array(
    z.object({
      ownerName: z.string(),
      // z.any() used because PromptEntry is a complex abstract class type
      prompt: z.any(),
    }),
  ),
  resolvedPrompts: z.array(
    z.object({
      ownerName: z.string(),
      // z.any() used because PromptEntry is a complex abstract class type
      prompt: z.any(),
      finalName: z.string(),
    }),
  ),
});

type ResponsePromptItem = Prompt;

const plan = {
  pre: ['parseInput', 'ensureRemoteCapabilities'],
  execute: ['findPrompts', 'resolveConflicts'],
  post: ['parsePrompts'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'prompts:list-prompts': FlowRunOptions<
      PromptsListFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'prompts:list-prompts' as const;
const { Stage } = FlowHooksOf('prompts:list-prompts');

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class PromptsListFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('PromptsListFlow');

  private sample<T>(arr: T[], n = 5): T[] {
    return arr.slice(0, n);
  }

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    let params: { cursor?: string } | undefined;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params as { cursor?: string } | undefined;
    } catch (e) {
      throw new InvalidInputError('Invalid request format', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'prompts/list') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'prompts/list');
    }

    const cursor = params?.cursor;
    if (cursor) this.logger.verbose(`parseInput: cursor=${cursor}`);
    this.state.set('cursor', cursor);
    this.logger.verbose('parseInput:done');
  }

  /**
   * Ensure remote app capabilities are loaded before listing prompts.
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

  @Stage('findPrompts')
  async findPrompts() {
    this.logger.info('findPrompts:start');

    try {
      const prompts: Array<{ ownerName: string; prompt: PromptEntry }> = [];
      const seenPromptIds = new Set<string>();

      // Get prompts from scope's prompt registry
      const scopePrompts = this.scope.prompts.getPrompts();
      this.logger.verbose(`findPrompts: scope prompts=${scopePrompts.length}`);

      for (const prompt of scopePrompts) {
        // Deduplicate prompts by their unique ID (fullName or metadata.name)
        const promptId = prompt.fullName || prompt.metadata.name;
        if (!seenPromptIds.has(promptId)) {
          seenPromptIds.add(promptId);
          prompts.push({ ownerName: prompt.owner.id, prompt });
        }
      }

      this.logger.info(`findPrompts: total prompts collected=${prompts.length} (deduped from ${scopePrompts.length})`);
      if (prompts.length === 0) {
        this.logger.warn('findPrompts: no prompts found');
      }

      this.state.set('prompts', prompts);
      this.logger.verbose('findPrompts:done');
    } catch (error) {
      this.logger.error('findPrompts: failed to collect prompts', error);
      throw error;
    }
  }

  @Stage('resolveConflicts')
  async resolveConflicts() {
    this.logger.verbose('resolveConflicts:start');

    try {
      const found = this.state.required.prompts;

      const counts = new Map<string, number>();
      for (const { prompt } of found) {
        const baseName = prompt.metadata.name;
        counts.set(baseName, (counts.get(baseName) ?? 0) + 1);
      }

      const conflicts = new Set<string>([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));

      if (conflicts.size > 0) {
        const preview = this.sample(Array.from(conflicts)).join(', ');
        const extra = conflicts.size > 5 ? `, +${conflicts.size - 5} more` : '';
        this.logger.warn(`resolveConflicts: ${conflicts.size} name conflict(s) detected: ${preview}${extra}`);
      } else {
        this.logger.info('resolveConflicts: no name conflicts detected');
      }

      const resolved = found.map(({ ownerName, prompt }) => {
        const baseName = prompt.metadata.name;
        const finalName = conflicts.has(baseName) ? `${ownerName}:${baseName}` : baseName;
        return { ownerName, prompt, finalName };
      });

      this.state.set('resolvedPrompts', resolved);
      this.logger.verbose('resolveConflicts:done');
    } catch (error) {
      this.logger.error('resolveConflicts: failed to resolve conflicts', error);
      throw error;
    }
  }

  @Stage('parsePrompts')
  async parsePrompts() {
    this.logger.verbose('parsePrompts:start');

    try {
      const resolved = this.state.required.resolvedPrompts;

      const prompts: ResponsePromptItem[] = resolved.map(({ finalName, prompt }) => ({
        name: finalName,
        title: prompt.metadata.title,
        description: prompt.metadata.description,
        arguments: prompt.metadata.arguments,
        icons: prompt.metadata.icons,
      }));

      const preview = this.sample(prompts.map((p) => p.name)).join(', ');
      const extra = prompts.length > 5 ? `, +${prompts.length - 5} more` : '';
      this.logger.info(`parsePrompts: prepared ${prompts.length} prompt descriptor(s): ${preview}${extra}`);

      this.respond({ prompts });
      this.logger.info('parsePrompts: response sent');
      this.logger.verbose('parsePrompts:done');
    } catch (error) {
      if (error instanceof FlowControl) throw error;
      this.logger.error('parsePrompts: failed to parse prompts', error);
      throw error;
    }
  }
}
