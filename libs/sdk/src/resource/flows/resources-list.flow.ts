// file: libs/sdk/src/resource/flows/resources-list.flow.ts

import { Flow, FlowBase, FlowControl, FlowHooksOf, FlowPlan, FlowRunOptions, ResourceEntry } from '../../common';
import 'reflect-metadata';
import { z } from 'zod';
import { ListResourcesRequestSchema, ListResourcesResultSchema, Resource } from '@modelcontextprotocol/sdk/types.js';
import { InvalidMethodError, InvalidInputError } from '../../errors';

const inputSchema = z.object({
  request: ListResourcesRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = ListResourcesResultSchema;

const stateSchema = z.object({
  cursor: z.string().optional(),
  resources: z.array(
    z.object({
      ownerName: z.string(),
      resource: z.instanceof(ResourceEntry),
    }),
  ),
  resolvedResources: z.array(
    z.object({
      ownerName: z.string(),
      resource: z.instanceof(ResourceEntry),
      finalName: z.string(),
    }),
  ),
});

type ResponseResourceItem = Resource;

const plan = {
  pre: ['parseInput', 'ensureRemoteCapabilities'],
  execute: ['findResources', 'resolveConflicts'],
  post: ['parseResources'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'resources:list-resources': FlowRunOptions<
      ResourcesListFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'resources:list-resources' as const;
const { Stage } = FlowHooksOf('resources:list-resources');

@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ResourcesListFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ResourcesListFlow');

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

    if (method !== 'resources/list') {
      this.logger.warn(`parseInput: invalid method "${method}"`);
      throw new InvalidMethodError(method, 'resources/list');
    }

    const cursor = params?.cursor;
    if (cursor) this.logger.verbose(`parseInput: cursor=${cursor}`);
    this.state.set('cursor', cursor);
    this.logger.verbose('parseInput:done');
  }

  /**
   * Ensure remote app capabilities are loaded before listing resources.
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

  @Stage('findResources')
  async findResources() {
    this.logger.info('findResources:start');

    try {
      const resources: Array<{ ownerName: string; resource: ResourceEntry }> = [];
      const seenResourceIds = new Set<string>();

      // Get resources from scope's resource registry
      const scopeResources = this.scope.resources.getResources();
      this.logger.verbose(`findResources: scope resources=${scopeResources.length}`);

      for (const resource of scopeResources) {
        // Deduplicate resources by their URI (unique identifier)
        // Use resource.uri (from entry) or fall back to metadata.name
        const resourceId = resource.uri || resource.metadata.name;
        if (!seenResourceIds.has(resourceId)) {
          seenResourceIds.add(resourceId);
          resources.push({ ownerName: resource.owner.id, resource });
        }
      }

      this.logger.info(
        `findResources: total resources collected=${resources.length} (deduped from ${scopeResources.length})`,
      );
      if (resources.length === 0) {
        this.logger.warn('findResources: no resources found');
      }

      this.state.set('resources', resources);
      this.logger.verbose('findResources:done');
    } catch (error) {
      this.logger.error('findResources: failed to collect resources', error);
      throw error;
    }
  }

  @Stage('resolveConflicts')
  async resolveConflicts() {
    this.logger.verbose('resolveConflicts:start');

    try {
      const found = this.state.required.resources;

      const counts = new Map<string, number>();
      for (const { resource } of found) {
        const baseName = resource.metadata.name;
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

      const resolved = found.map(({ ownerName, resource }) => {
        const baseName = resource.metadata.name;
        const finalName = conflicts.has(baseName) ? `${ownerName}:${baseName}` : baseName;
        return { ownerName, resource, finalName };
      });

      this.state.set('resolvedResources', resolved);
      this.logger.verbose('resolveConflicts:done');
    } catch (error) {
      this.logger.error('resolveConflicts: failed to resolve conflicts', error);
      throw error;
    }
  }

  @Stage('parseResources')
  async parseResources() {
    this.logger.verbose('parseResources:start');

    try {
      const resolved = this.state.required.resolvedResources;

      // Log resources that will be filtered out due to missing URI
      const withoutUri = resolved.filter(({ resource }) => resource.uri == null);
      if (withoutUri.length > 0) {
        this.logger.warn(`parseResources: ${withoutUri.length} resource(s) skipped due to missing URI`);
      }

      const resources: ResponseResourceItem[] = resolved
        .filter(({ resource }) => resource.uri != null)
        .map(({ finalName, resource }) => {
          // Extract uri with type narrowing (guaranteed by filter above)
          const uri = resource.uri as string;

          const item: ResponseResourceItem = {
            uri,
            name: finalName,
            title: resource.metadata.title,
            description: resource.metadata.description,
            mimeType: resource.metadata.mimeType,
            icons: resource.metadata.icons,
          };

          // Add OpenAI-specific _meta for skybridge widget resources
          // This is CRITICAL for ChatGPT to discover and render widgets
          if (resource.metadata.mimeType === 'text/html+skybridge') {
            item._meta = {
              'openai/outputTemplate': uri,
              'openai/resultCanProduceWidget': true,
              'openai/widgetAccessible': true,
            };
          }

          return item;
        });

      const preview = this.sample(resources.map((r) => r.name)).join(', ');
      const extra = resources.length > 5 ? `, +${resources.length - 5} more` : '';
      this.logger.info(`parseResources: prepared ${resources.length} resource descriptor(s): ${preview}${extra}`);

      this.respond({ resources });
      this.logger.info('parseResources: response sent');
      this.logger.verbose('parseResources:done');
    } catch (error) {
      if (error instanceof FlowControl) throw error;
      this.logger.error('parseResources: failed to parse resources', error);
      throw error;
    }
  }
}
