// file: libs/sdk/src/resource/flows/resources-list.flow.ts

import {
  Flow,
  FlowBase,
  FlowControl,
  FlowHooksOf,
  ResourceEntry,
  type FlowPlan,
  type FlowRunOptions,
  type SkillEntry,
} from '../../common';

import 'reflect-metadata';

import { internalZ as z } from '@frontmcp/lazy-zod';
import { ListResourcesRequestSchema, ListResourcesResultSchema, type Resource } from '@frontmcp/protocol';

import { annotationsForClient, callerClientProfile, type ClientNameSources } from '../../answer';
import { callSurfaceOf, isOfferedOnSurface } from '../../common/availability';
import { InvalidInputError, InvalidMethodError } from '../../errors';
import { SEP_2640_META_NAMESPACE } from '../../skill/sep-2640/sep-2640.constants';
import { filterServableSkills } from '../../skill/skill-filter.helper';
import { enabledItems, SURFACE_META_KEY, surfaceHash } from '../../surface';

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
  execute: ['findResources', 'filterByEnabled', 'filterByAuthorities', 'filterSkillResources', 'resolveConflicts'],
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
    let params: { cursor?: string } | undefined;
    try {
      const inputData = inputSchema.parse(this.rawInput);
      method = inputData.request.method;
      params = inputData.request.params as { cursor?: string } | undefined;
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
    this.logger.verbose('findResources:start');

    try {
      const resources: Array<{ ownerName: string; resource: ResourceEntry }> = [];
      const seenResourceIds = new Set<string>();

      // Get resources from scope's resource registry
      // `availableWhen.surface`: leave out resources not offered to the surface this listing is for.
      const callSurface = callSurfaceOf((this.rawInput as { ctx?: unknown } | undefined)?.ctx);
      const scopeResources = this.scope.resources
        .getResources()
        .filter((resource) => isOfferedOnSurface(resource.metadata.availableWhen, callSurface));
      this.logger.verbose(`findResources: scope resources=${scopeResources.length}`);

      for (const resource of scopeResources) {
        // A resource whose URI another app registered first is never read, so it is not listed either
        if (resource.uri && this.scope.resources.findByUri(resource.uri) !== resource) continue;
        // Deduplicate resources by owner + URI/name combination
        // This prevents the same resource from being registered twice while allowing
        // different owners to have resources with the same name (for conflict resolution)
        const resourceId = `${resource.owner.id}:${resource.uri || resource.metadata.name}`;
        if (!seenResourceIds.has(resourceId)) {
          seenResourceIds.add(resourceId);
          resources.push({ ownerName: resource.owner.id, resource });
        }
      }

      this.logger.verbose(
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

  /** Leave out the resources whose `enabled` is off for this request. */
  @Stage('filterByEnabled')
  async filterByEnabled() {
    const { resources } = this.state.required;
    this.state.set(
      'resources',
      await enabledItems(resources, ({ resource }) => resource.metadata.enabled, this.tryGetContext(), this.logger),
    );
  }

  /**
   * Filter resources by entry-level authorities.
   * Hookable: developers can use Will/Did/Around on 'filterByAuthorities'.
   */
  @Stage('filterByAuthorities')
  async filterByAuthorities() {
    this.logger.verbose('filterByAuthorities:start');
    const engine = this.scope.authoritiesEngine;
    const ctxBuilder = this.scope.authoritiesContextBuilder;
    if (!engine || !ctxBuilder) return;

    const resources = this.state.required.resources;
    const ctx = (this.rawInput as Record<string, unknown>)['ctx'] as Record<string, unknown> | undefined;
    const authInfo = (ctx?.['authInfo'] ?? {}) as Record<string, unknown>;

    const filtered = await Promise.all(
      resources.map(async (item) => {
        const metadata = item.resource.metadata as unknown as Record<string, unknown>;
        const authorities = metadata['authorities'];
        if (!authorities) return item;

        const evalCtx = ctxBuilder.build(authInfo);
        const result = await engine.evaluate(authorities as import('@frontmcp/auth').AuthoritiesMetadata, evalCtx);
        return result.granted ? item : null;
      }),
    );

    this.state.set(
      'resources',
      filtered.filter((item): item is (typeof resources)[number] => item !== null),
    );
    this.logger.verbose('filterByAuthorities:done');
  }

  /** Leave out a skill's SKILL.md the `skills:filter` flow keeps from this caller, as reading it and `skill://index.json` do. */
  @Stage('filterSkillResources')
  async filterSkillResources() {
    const { resources } = this.state.required;
    const skillRegistry = this.scope.skills;
    if (!skillRegistry?.hasAny()) return;

    const skillsByPath = new Map<string, SkillEntry>();
    for (const skill of skillRegistry.getSkills({ visibility: 'mcp' })) {
      if (!skillsByPath.has(skill.getSkillPath())) skillsByPath.set(skill.getSkillPath(), skill);
    }
    const skillOfResource = new Map<(typeof resources)[number], SkillEntry | undefined>();
    for (const item of resources) {
      const skillPath = item.resource.metadata._meta?.[`${SEP_2640_META_NAMESPACE}path`];
      if (typeof skillPath === 'string') skillOfResource.set(item, skillsByPath.get(skillPath));
    }
    if (skillOfResource.size === 0) return;

    const listedSkills = [...skillOfResource.values()].filter((skill): skill is SkillEntry => skill !== undefined);
    const ctx = (this.rawInput as { ctx?: unknown } | undefined)?.ctx;
    const servableSkills = new Set<SkillEntry>(await filterServableSkills(this.scope, listedSkills, ctx));
    this.state.set(
      'resources',
      resources.filter((item) => {
        const skill = skillOfResource.get(item);
        return skill === undefined || servableSkills.has(skill);
      }),
    );
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
        this.logger.verbose('resolveConflicts: no name conflicts detected');
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

      // A `clients` profile can drop numeric annotations, or give each SKILL.md its priority
      const annotationsMode = callerClientProfile(this.scope.metadata.clients, {
        context: this.tryGetContext(),
        authInfo: (this.input.ctx as { authInfo?: ClientNameSources['authInfo'] } | undefined)?.authInfo,
        notifications: this.scope.notifications,
      })?.annotations;

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

          // Forward MCP `annotations` (audience, priority, lastModified) when set
          // — used by SEP-2640 skill resources to declare assistant-targeted
          // priority for SKILL.md vs lower priority for sub-files.
          const isSkillMd = uri.startsWith('skill://') && uri.endsWith('/SKILL.md');
          const annotations = annotationsForClient(resource.metadata.annotations, annotationsMode, isSkillMd);
          if (annotations) {
            (item as ResponseResourceItem & { annotations?: typeof annotations }).annotations = annotations;
          }

          // Merge `_meta` from metadata first; the per-mimeType branch below
          // can still add keys.
          const metaFromMetadata = resource.metadata._meta;
          if (metaFromMetadata && Object.keys(metaFromMetadata).length > 0) {
            item._meta = { ...metaFromMetadata };
          }

          // Add _meta for MCP Apps widget resources (ui/* namespace per spec).
          // Nested-merge so existing _meta.ui keys are preserved. Validate
          // the existing `ui` value at runtime before spreading — a plugin
          // could legitimately put a non-object there, in which case we
          // overwrite with our object form rather than throw.
          if (resource.metadata.mimeType === 'text/html;profile=mcp-app') {
            const rawUi = item._meta?.['ui'];
            const existingUi: Record<string, unknown> =
              rawUi !== null && typeof rawUi === 'object' && !Array.isArray(rawUi)
                ? (rawUi as Record<string, unknown>)
                : {};
            item._meta = {
              ...(item._meta ?? {}),
              ui: {
                ...existingUi,
                resourceUri: uri,
              },
            };
          }

          return item;
        });

      const preview = this.sample(resources.map((r) => r.name)).join(', ');
      const extra = resources.length > 5 ? `, +${resources.length - 5} more` : '';
      this.logger.verbose(`parseResources: prepared ${resources.length} resource descriptor(s): ${preview}${extra}`);

      this.respond({ resources, _meta: { [SURFACE_META_KEY]: surfaceHash(resources.map(({ uri }) => uri)) } });
      this.logger.verbose('parseResources: response sent');
      this.logger.verbose('parseResources:done');
    } catch (error) {
      if (error instanceof FlowControl) throw error;
      this.logger.error('parseResources: failed to parse resources', error);
      throw error;
    }
  }
}
