// file: libs/sdk/src/resource/resource.registry.ts

import { Token, tokenName, getMetadata } from '@frontmcp/di';
import {
  EntryLineage,
  EntryOwnerRef,
  ResourceEntry,
  ResourceRecord,
  ResourceTemplateRecord,
  ResourceRegistryInterface,
  ResourceType,
} from '../common';
import { ResourceChangeEvent, ResourceEmitter } from './resource.events';
import ProviderRegistry from '../provider/provider.registry';
import { ensureMaxLen, sepFor } from '@frontmcp/utils';
import { normalizeOwnerPath, normalizeProviderId, normalizeSegment } from '../utils/naming.utils';
import { ownerKeyOf, qualifiedNameOf } from '../utils/lineage.utils';
import {
  normalizeResource,
  normalizeResourceTemplate,
  isResourceTemplate,
  resourceDiscoveryDeps,
} from './resource.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { ResourceInstance } from './resource.instance';
import { DEFAULT_RESOURCE_EXPORT_OPTS, ResourceExportOptions, IndexedResource } from './resource.types';
import ReadResourceFlow from './flows/read-resource.flow';
import ResourcesListFlow from './flows/resources-list.flow';
import ResourceTemplatesListFlow from './flows/resource-templates-list.flow';
import SubscribeResourceFlow from './flows/subscribe-resource.flow';
import UnsubscribeResourceFlow from './flows/unsubscribe-resource.flow';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

export default class ResourceRegistry
  extends RegistryAbstract<
    ResourceInstance, // instances map holds ResourceInstance
    ResourceRecord | ResourceTemplateRecord,
    ResourceType[]
  >
  implements ResourceRegistryInterface
{
  /** Who owns this registry (used for provenance). */
  owner: EntryOwnerRef;

  /** Resources truly owned/constructed by THIS registry (with lineage applied) */
  private localRows: IndexedResource[] = [];

  /** Adopted resource rows from each child registry (references to the same instances) */
  private adopted = new Map<ResourceRegistry, IndexedResource[]>();

  /** Children registries that we track */
  private children = new Set<ResourceRegistry>();

  // ---- O(1) indexes over EFFECTIVE set (local + adopted) ----
  private byQualifiedId = new Map<string, IndexedResource>(); // qualifiedId -> row
  private byName = new Map<string, IndexedResource[]>(); // baseName -> rows
  private byUri = new Map<string, IndexedResource>(); // uri -> row (static resources)
  private byUriTemplate = new Map<string, IndexedResource>(); // uriTemplate -> row (templates)
  private byOwnerAndName = new Map<string, IndexedResource>(); // "ownerKey:name" -> row
  private byOwner = new Map<string, IndexedResource[]>(); // ownerKey -> rows

  // version + emitter
  private version = 0;
  private emitter = new ResourceEmitter();

  constructor(providers: ProviderRegistry, list: ResourceType[], owner: EntryOwnerRef) {
    // disable auto so subclass fields initialize first
    super('ResourceRegistry', providers, list, false);
    this.owner = owner;

    // now it's safe to run the lifecycle
    this.buildGraph();
    this.ready = this.initialize();
  }

  /* -------------------- Build-time: defs + dep checks -------------------- */

  protected override buildMap(list: ResourceType[]): RegistryBuildMapResult<ResourceRecord | ResourceTemplateRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, ResourceRecord | ResourceTemplateRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      // Determine if it's a template or static resource
      const isTemplate = isResourceTemplate(raw);
      const rec = isTemplate ? normalizeResourceTemplate(raw) : normalizeResource(raw);

      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }
    return { tokens, defs, graph };
  }

  protected buildGraph() {
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;
      const deps = resourceDiscoveryDeps(rec);

      for (const d of deps) {
        // Validate against hierarchical providers; throws early if missing
        this.providers.get(d);
        this.graph.get(token)!.add(d);
      }
    }
  }

  /* -------------------- Initialize: create ONE ResourceInstance per local resource -------------------- */

  protected override async initialize(): Promise<void> {
    // Instantiate each local resource once and store in this.instances
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;

      // Single, authoritative instance per local resource
      const ri = new ResourceInstance(rec, this.providers, this.owner);
      this.instances.set(token as Token<ResourceInstance>, ri);

      const lineage: EntryLineage = this.owner ? [this.owner] : [];
      const row = this.makeRow(token, ri, lineage, this);
      this.localRows.push(row);
    }

    // Adopt resources from child app registries
    const childAppRegistries = this.providers.getRegistries('AppRegistry');
    childAppRegistries.forEach((appRegistry) => {
      const apps = appRegistry.getApps();
      for (const app of apps) {
        // Check if this is a remote app (has getMcpClient method)
        // Remote apps use RemoteResourceRegistry which isn't registered as a child registry
        const isRemoteApp = typeof (app as { getMcpClient?: unknown }).getMcpClient === 'function';

        if (isRemoteApp) {
          // For remote apps, directly adopt resources from the app's resources registry
          const remoteResources = app.resources.getResources();
          const remoteTemplates = app.resources.getResourceTemplates();
          const allRemoteResources = [...remoteResources, ...remoteTemplates];
          if (allRemoteResources.length > 0) {
            const prepend: EntryLineage = this.owner ? [this.owner] : [];
            for (const remoteResource of allRemoteResources) {
              const row = this.makeRow(Symbol(remoteResource.name), remoteResource as ResourceInstance, prepend, this);
              this.localRows.push(row);
            }
          }
        } else {
          // For local apps, adopt from child ResourceRegistry instances
          const appResourceRegistries = app.providers.getRegistries('ResourceRegistry');
          appResourceRegistries
            .filter((r) => r.owner.kind === 'app')
            .forEach((appResourceRegistry) => {
              this.adoptFromChild(appResourceRegistry as ResourceRegistry, appResourceRegistry.owner);
            });
        }
      }
    });

    // Adopt resources from other child resource registries
    const childResourceRegistries = this.providers.getRegistries('ResourceRegistry');
    childResourceRegistries
      .filter((r) => r !== this)
      .forEach((resourceRegistry) => {
        this.adoptFromChild(resourceRegistry as ResourceRegistry, resourceRegistry.owner);
      });

    // Build effective indexes from (locals + already adopted children)
    this.reindex();
    this.bump('reset');

    // Register resource flows with the scope
    const scope = this.providers.getActiveScope();
    await scope.registryFlows(
      ReadResourceFlow,
      ResourcesListFlow,
      ResourceTemplatesListFlow,
      SubscribeResourceFlow,
      UnsubscribeResourceFlow,
    );
  }

  /* -------------------- Adoption: reference child instances (no cloning) -------------------- */

  /**
   * Adopt resources from a child registry. Parent runs after children are ready.
   * We *reference* the child's resource instances; no duplicates are created.
   */
  adoptFromChild(child: ResourceRegistry, _childOwner: EntryOwnerRef): void {
    if (this.children.has(child)) return;

    const childRows = child.listAllIndexed();
    const prepend: EntryLineage = this.owner ? [this.owner] : [];

    const adoptedRows = childRows.map((r) => this.relineage(r, prepend));

    this.adopted.set(child, adoptedRows);
    this.children.add(child);

    // keep live if child changes
    child.subscribe({ immediate: false }, () => {
      const latest = child.listAllIndexed().map((r) => this.relineage(r, prepend));
      this.adopted.set(child, latest);
      this.reindex();
      this.bump('reset');
    });

    this.reindex();
    this.bump('reset');
  }

  /* -------------------- Public API -------------------- */

  /**
   * Get all static resources (not templates)
   */
  getResources(includeHidden = false): ResourceEntry[] {
    const all = this.listAllIndexed();
    return all
      .filter((r) => !r.isTemplate)
      .filter((r) => {
        const meta = r.instance.metadata;
        const hidden = 'hideFromDiscovery' in meta && meta.hideFromDiscovery === true;
        return !hidden || includeHidden;
      })
      .map((r) => r.instance);
  }

  /**
   * Get all resource templates
   */
  getResourceTemplates(): ResourceEntry[] {
    const all = this.listAllIndexed();
    return all.filter((r) => r.isTemplate).map((r) => r.instance);
  }

  /**
   * Get inline resources (local only)
   */
  getInlineResources(): ResourceEntry[] {
    return [...this.instances.values()];
  }

  /**
   * Find a resource by exact URI match
   */
  findByUri(uri: string): ResourceInstance | undefined {
    const row = this.byUri.get(uri);
    return row?.instance;
  }

  /**
   * Match a URI against template resources and extract parameters
   */
  matchTemplateByUri(uri: string): { instance: ResourceInstance; params: Record<string, string> } | undefined {
    // Try each template resource
    for (const row of this.listAllIndexed()) {
      if (!row.isTemplate) continue;

      const match = row.instance.matchUri(uri);
      if (match.matches) {
        return { instance: row.instance, params: match.params };
      }
    }
    return undefined;
  }

  /**
   * Find a resource by URI - tries exact match first, then template matching
   */
  findResourceForUri(uri: string): { instance: ResourceInstance; params: Record<string, string> } | undefined {
    // Try exact URI match first
    const exact = this.findByUri(uri);
    if (exact) {
      return { instance: exact, params: {} };
    }

    // Try template matching
    return this.matchTemplateByUri(uri);
  }

  /** Internal snapshot of effective indexed rows (locals + adopted). */
  listAllIndexed(): IndexedResource[] {
    return [...this.localRows, ...[...this.adopted.values()].flat()];
  }

  /** List all instances (locals + adopted). */
  listAllInstances(): readonly ResourceInstance[] {
    return this.listAllIndexed().map((r) => r.instance);
  }

  /** List instances by owner path (e.g. "app:Portal/plugin:Okta") */
  listByOwner(ownerPath: string): readonly ResourceInstance[] {
    return (this.byOwner.get(ownerPath) ?? []).map((r) => r.instance);
  }

  /* -------------------- Indexing & lookups -------------------- */

  private reindex() {
    const effective = this.listAllIndexed();

    this.byQualifiedId.clear();
    this.byName.clear();
    this.byUri.clear();
    this.byUriTemplate.clear();
    this.byOwnerAndName.clear();
    this.byOwner.clear();

    for (const r of effective) {
      this.byQualifiedId.set(r.qualifiedId, r);

      const listByName = this.byName.get(r.baseName) ?? [];
      listByName.push(r);
      this.byName.set(r.baseName, listByName);

      const byOwnerKey = this.byOwner.get(r.ownerKey) ?? [];
      byOwnerKey.push(r);
      this.byOwner.set(r.ownerKey, byOwnerKey);

      const on = `${r.ownerKey}:${r.baseName}`;
      if (!this.byOwnerAndName.has(on)) this.byOwnerAndName.set(on, r);

      // Index by URI or URI template
      if (r.isTemplate && r.uriTemplate) {
        this.byUriTemplate.set(r.uriTemplate, r);
      } else if (r.uri) {
        this.byUri.set(r.uri, r);
      }
    }
  }

  /* -------------------- Conflict-aware exported names -------------------- */

  /**
   * Produce unique, MCP-valid exported names.
   */
  exportResolvedNames(opts?: ResourceExportOptions): Array<{ name: string; instance: ResourceInstance }> {
    const cfg = { ...DEFAULT_RESOURCE_EXPORT_OPTS, ...(opts ?? {}) };

    const rows = this.listAllIndexed().map((r) => {
      const base = normalizeSegment(r.baseName, cfg.case);
      const isLocal = r.source === this;
      const provider = normalizeProviderId(this.providerIdOf(r.instance), cfg.case);
      const ownerPath = normalizeOwnerPath(r.ownerKey, cfg.case);
      return { base, row: r, isLocal, provider, ownerPath };
    });

    // group by standardized base
    const byBase = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byBase.get(r.base) ?? [];
      list.push(r);
      byBase.set(r.base, list);
    }

    const out = new Map<string, ResourceInstance>();

    for (const [base, group] of byBase.entries()) {
      if (group.length === 1) {
        const g = group[0];
        out.set(ensureMaxLen(base, cfg.maxLen), g.row.instance);
        continue;
      }

      const locals = group.filter((g) => g.isLocal);
      const children = group.filter((g) => !g.isLocal);

      if (cfg.prefixChildrenOnConflict && locals.length > 0) {
        // Locals
        if (locals.length === 1) {
          const localName = ensureMaxLen(base, cfg.maxLen);
          out.set(disambiguate(localName, out, cfg), locals[0].row.instance);
        } else {
          for (const l of locals) {
            const pref = normalizeOwnerPath(l.ownerPath, cfg.case);
            const name = ensureMaxLen(`${pref}${sepFor(cfg.case)}${base}`, cfg.maxLen);
            out.set(disambiguate(name, out, cfg), l.row.instance);
          }
        }

        // Children
        for (const c of children) {
          const pre = cfg.prefixSource === 'provider' ? c.provider ?? c.ownerPath : c.ownerPath;
          const name = ensureMaxLen(`${pre}${sepFor(cfg.case)}${base}`, cfg.maxLen);
          out.set(disambiguate(name, out, cfg), c.row.instance);
        }
      } else {
        // Prefix everyone by source
        for (const r of group) {
          const pre = cfg.prefixSource === 'provider' ? r.provider ?? r.ownerPath : r.ownerPath;
          const name = ensureMaxLen(`${pre}${sepFor(cfg.case)}${base}`, cfg.maxLen);
          out.set(disambiguate(name, out, cfg), r.row.instance);
        }
      }
    }

    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, instance]) => ({ name, instance }));

    function disambiguate(candidate: string, pool: Map<string, any>, cfg: Required<ResourceExportOptions>): string {
      if (!pool.has(candidate)) return candidate;
      const maxAttempts = 10000;
      let n = 2;
      while (n <= maxAttempts) {
        const withN = ensureMaxLen(`${candidate}${sepFor(cfg.case)}${n}`, cfg.maxLen);
        if (!pool.has(withN)) return withN;
        n++;
      }
      throw new Error(`Failed to disambiguate name "${candidate}" after ${maxAttempts} attempts`);
    }
  }

  /** Lookup by the exported (resolved) name. */
  getExported(name: string, opts?: ResourceExportOptions): ResourceInstance | undefined {
    const pairs = this.exportResolvedNames(opts);
    return pairs.find((p) => p.name === name)?.instance;
  }

  /* -------------------- Subscriptions -------------------- */

  subscribe(
    opts: { immediate?: boolean; filter?: (i: ResourceInstance) => boolean },
    cb: (evt: ResourceChangeEvent) => void,
  ): () => void {
    const filter = opts.filter ?? (() => true);
    if (opts.immediate) {
      cb({
        kind: 'reset',
        changeScope: 'global',
        version: this.version,
        snapshot: this.listAllInstances().filter(filter),
      });
    }
    return this.emitter.on((e) => cb({ ...e, snapshot: this.listAllInstances().filter(filter) }));
  }

  private bump(kind: ResourceChangeEvent['kind']) {
    const version = ++this.version;
    this.emitter.emit({ kind, changeScope: 'global', version, snapshot: this.listAllInstances() });
  }

  /* -------------------- Helpers -------------------- */

  /** Build an IndexedResource row */
  private makeRow(
    token: Token,
    instance: ResourceInstance,
    lineage: EntryLineage,
    source: ResourceRegistry,
  ): IndexedResource {
    const ownerKey = ownerKeyOf(lineage);
    const baseName = instance.name;
    const qualifiedName = qualifiedNameOf(lineage, baseName);
    const qualifiedId = `${ownerKey}:${tokenName(token)}`;
    return {
      token,
      instance,
      baseName,
      uri: instance.uri,
      uriTemplate: instance.uriTemplate,
      isTemplate: instance.isTemplate,
      lineage,
      ownerKey,
      qualifiedName,
      qualifiedId,
      source,
    };
  }

  /** Clone a child row and prepend lineage (with adjacent de-dup to avoid double prefixes). */
  private relineage(row: IndexedResource, prepend: EntryLineage): IndexedResource {
    const merged = [...prepend, ...row.lineage];
    const lineage = dedupLineage(merged);

    const ownerKey = ownerKeyOf(lineage);
    const qualifiedName = qualifiedNameOf(lineage, row.baseName);
    const qualifiedId = `${ownerKey}:${tokenName(row.token)}`;
    return {
      token: row.token,
      instance: row.instance, // REFERENCE the same instance
      baseName: row.baseName,
      uri: row.uri,
      uriTemplate: row.uriTemplate,
      isTemplate: row.isTemplate,
      lineage,
      ownerKey,
      qualifiedName,
      qualifiedId,
      source: row.source, // keep original source (who constructed instance)
    };
  }

  /** Best-effort provider id used for prefixing. */
  private providerIdOf(inst: ResourceInstance): string | undefined {
    try {
      const meta: unknown = inst.getMetadata?.();
      if (!meta || typeof meta !== 'object') return undefined;

      const metaObj = meta as Record<string, unknown>;
      const maybe = metaObj['providerId'] ?? metaObj['provider'] ?? metaObj['ownerId'];
      if (typeof maybe === 'string' && maybe.length > 0) return maybe;

      const cls = metaObj['cls'];
      if (cls && typeof cls === 'function') {
        const id = getMetadata('id', cls);
        if (typeof id === 'string' && id.length > 0) return id;
        if ('name' in cls && typeof cls.name === 'string') return cls.name;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  /** True if this registry (or adopted children) has any resources. */
  hasAny(): boolean {
    return this.listAllIndexed().length > 0 || this.tokens.size > 0;
  }

  /**
   * Get the MCP capabilities for resources.
   * These are reported to clients during initialization.
   */
  getCapabilities(): Partial<ServerCapabilities> {
    return this.hasAny()
      ? {
          resources: {
            // Subscription support per MCP 2025-11-25 spec
            subscribe: true,
            // List change notifications are only supported when resources are registered
            listChanged: true,
          },
        }
      : {};
  }

  /**
   * Dynamically register a resource or resource template at runtime.
   *
   * Used for system resources like the ui:// template that should be
   * registered when tools with UI configs exist.
   *
   * @param resourceDef - Resource class, function, or template to register
   */
  registerDynamicResource(resourceDef: ResourceType): void {
    const isTemplate = isResourceTemplate(resourceDef);
    const rec = isTemplate ? normalizeResourceTemplate(resourceDef) : normalizeResource(resourceDef);
    const token = rec.provide;

    // Skip if already registered
    if (this.tokens.has(token)) {
      return;
    }

    // Add to registry structures
    this.tokens.add(token);
    this.defs.set(token, rec);

    // Build dependency graph (same pattern as buildGraph)
    const deps = resourceDiscoveryDeps(rec);
    const depSet = new Set<Token>();
    for (const d of deps) {
      // Validate against hierarchical providers; throws early if missing
      this.providers.get(d);
      depSet.add(d);
    }
    this.graph.set(token, depSet);

    // Create instance
    const ri = new ResourceInstance(rec, this.providers, this.owner);
    this.instances.set(token as Token<ResourceInstance>, ri);

    // Add to local rows with lineage
    const lineage: EntryLineage = this.owner ? [this.owner] : [];
    const row = this.makeRow(token, ri, lineage, this);
    this.localRows.push(row);

    // Rebuild indexes and emit change event
    this.reindex();
    this.bump('reset');
  }
}

/* -------------------- lineage utility -------------------- */

/** Remove only adjacent duplicates like [adapter:x, adapter:x] → [adapter:x] */
function dedupLineage(l: EntryLineage): EntryLineage {
  const out: EntryLineage = [];
  for (const o of l) {
    const last = out[out.length - 1];
    if (!last || last.kind !== o.kind || last.id !== o.id) out.push(o);
  }
  return out;
}
