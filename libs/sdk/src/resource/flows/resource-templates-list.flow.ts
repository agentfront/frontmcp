// file: libs/sdk/src/resource/flows/resource-templates-list.flow.ts

import { Flow, FlowBase, FlowControl, FlowHooksOf, FlowPlan, FlowRunOptions, ResourceEntry } from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import {
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError } from '../../errors';

const inputSchema = z.object({
  request: ListResourceTemplatesRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = ListResourceTemplatesResultSchema;

const stateSchema = z.object({
  cursor: z.string().optional(),
  templates: z.array(
    z.object({
      ownerName: z.string(),
      template: z.instanceof(ResourceEntry),
    }),
  ),
  resolvedTemplates: z.array(
    z.object({
      ownerName: z.string(),
      template: z.instanceof(ResourceEntry),
      finalName: z.string(),
    }),
  ),
});

type ResponseTemplateItem = ResourceTemplate;

const plan = {
  pre: ['parseInput', 'ensureRemoteCapabilities'],
  execute: ['findTemplates', 'resolveConflicts'],
  post: ['parseTemplates'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'resources:list-resource-templates': FlowRunOptions<
      ResourceTemplatesListFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'resources:list-resource-templates' as const;
const { Stage } = FlowHooksOf('resources:list-resource-templates');

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ResourceTemplatesListFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ResourceTemplatesListFlow');

  private sample<T>(arr: T[], n = 5): T[] {
    return arr.slice(0, n);
  }

  @Stage('parseInput')
  async parseInput() {
    this.logger.verbose('parseInput:start');

    let method!: string;
    let params: any;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params;
    } catch (e) {
      throw new InvalidInputError('Invalid request format', e instanceof z.ZodError ? e.issues : undefined);
    }

    if (method !== 'resources/templates/list') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'resources/templates/list');
    }

    const cursor = params?.cursor;
    if (cursor) this.logger.verbose(`parseInput: cursor=${cursor}`);
    this.state.set('cursor', cursor);
    this.logger.verbose('parseInput:done');
  }

  /**
   * Ensure remote app capabilities are loaded before listing resource templates.
   * Remote apps use lazy capability discovery - this triggers the loading.
   * Uses provider registry to find all remote apps across all app registries.
   */
  @Stage('ensureRemoteCapabilities')
  async ensureRemoteCapabilities() {
    this.logger.verbose('ensureRemoteCapabilities:start');

    // Get all apps from all app registries (same approach as ResourceRegistry.initialize)
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

  @Stage('findTemplates')
  async findTemplates() {
    this.logger.info('findTemplates:start');

    try {
      const templates: Array<{ ownerName: string; template: ResourceEntry }> = [];

      // Get resource templates from scope's resource registry
      const scopeTemplates = this.scope.resources.getResourceTemplates();
      this.logger.verbose(`findTemplates: scope templates=${scopeTemplates.length}`);

      for (const template of scopeTemplates) {
        templates.push({ ownerName: template.owner.id, template });
      }

      this.logger.info(`findTemplates: total templates collected=${templates.length}`);
      if (templates.length === 0) {
        this.logger.warn('findTemplates: no resource templates found');
      }

      this.state.set('templates', templates);
      this.logger.verbose('findTemplates:done');
    } catch (error) {
      this.logger.error('findTemplates: failed to collect templates', error);
      throw error;
    }
  }

  @Stage('resolveConflicts')
  async resolveConflicts() {
    this.logger.verbose('resolveConflicts:start');

    try {
      const found = this.state.required.templates;

      const counts = new Map<string, number>();
      for (const { template } of found) {
        const baseName = template.metadata.name;
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

      const resolved = found.map(({ ownerName, template }) => {
        const baseName = template.metadata.name;
        const finalName = conflicts.has(baseName) ? `${ownerName}:${baseName}` : baseName;
        return { ownerName, template, finalName };
      });

      this.state.set('resolvedTemplates', resolved);
      this.logger.verbose('resolveConflicts:done');
    } catch (error) {
      this.logger.error('resolveConflicts: failed to resolve conflicts', error);
      throw error;
    }
  }

  @Stage('parseTemplates')
  async parseTemplates() {
    this.logger.verbose('parseTemplates:start');

    try {
      const resolved = this.state.required.resolvedTemplates;

      const resourceTemplates: ResponseTemplateItem[] = resolved
        .filter(({ template }) => template.uriTemplate != null)
        .map(({ finalName, template }) => {
          // Extract uriTemplate with type narrowing (guaranteed by filter above)
          const uriTemplate = template.uriTemplate as string;

          const item: ResponseTemplateItem = {
            uriTemplate,
            name: finalName,
            title: template.metadata.title,
            description: template.metadata.description,
            mimeType: template.metadata.mimeType,
            icons: template.metadata.icons,
          };

          // Add OpenAI _meta for skybridge widget templates
          // This is CRITICAL for ChatGPT to discover widget-producing resources
          if (template.metadata.mimeType === 'text/html+skybridge') {
            item._meta = {
              'openai/outputTemplate': uriTemplate,
              'openai/resultCanProduceWidget': true,
              'openai/widgetAccessible': true,
            };
          }

          return item;
        });

      const preview = this.sample(resourceTemplates.map((t) => t.name)).join(', ');
      const extra = resourceTemplates.length > 5 ? `, +${resourceTemplates.length - 5} more` : '';
      this.logger.info(
        `parseTemplates: prepared ${resourceTemplates.length} template descriptor(s): ${preview}${extra}`,
      );

      this.respond({ resourceTemplates });
      this.logger.info('parseTemplates: response sent');
      this.logger.verbose('parseTemplates:done');
    } catch (error) {
      if (error instanceof FlowControl) throw error;
      this.logger.error('parseTemplates: failed to parse templates', error);
      throw error;
    }
  }
}
