// file: libs/sdk/src/prompt/prompt.registry.ts

import {
  EntryLineage,
  EntryOwnerRef,
  Token,
  PromptEntry,
  PromptRecord,
  PromptRegistryInterface,
  PromptType,
} from '../common';
import { getMetadata } from '../utils/metadata.utils';
import { PromptChangeEvent, PromptEmitter } from './prompt.events';
import ProviderRegistry from '../provider/provider.registry';
import {
  ensureMaxLen,
  normalizeOwnerPath,
  normalizeProviderId,
  normalizeSegment,
  normalizePrompt,
  ownerKeyOf,
  qualifiedNameOf,
  sepFor,
  promptDiscoveryDeps,
} from './prompt.utils';
import { tokenName } from '../utils/token.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { PromptInstance } from './prompt.instance';
import { DEFAULT_PROMPT_EXPORT_OPTS, PromptExportOptions, IndexedPrompt } from './prompt.types';
import GetPromptFlow from './flows/get-prompt.flow';
import PromptsListFlow from './flows/prompts-list.flow';
import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

/** Maximum attempts for name disambiguation to prevent infinite loops */
const MAX_DISAMBIGUATE_ATTEMPTS = 10000;

export default class PromptRegistry
  extends RegistryAbstract<
    PromptInstance, // instances map holds PromptInstance
    PromptRecord,
    PromptType[]
  >
  implements PromptRegistryInterface
{
  /** Who owns this registry (used for provenance). */
  owner: EntryOwnerRef;

  /** Prompts truly owned/constructed by THIS registry (with lineage applied) */
  private localRows: IndexedPrompt[] = [];

  /** Adopted prompt rows from each child registry (references to the same instances) */
  private adopted = new Map<PromptRegistry, IndexedPrompt[]>();

  /** Children registries that we track */
  private children = new Set<PromptRegistry>();

  // ---- O(1) indexes over EFFECTIVE set (local + adopted) ----
  private byQualifiedId = new Map<string, IndexedPrompt>(); // qualifiedId -> row
  private byName = new Map<string, IndexedPrompt[]>(); // baseName -> rows
  private byOwnerAndName = new Map<string, IndexedPrompt>(); // "ownerKey:name" -> row
  private byOwner = new Map<string, IndexedPrompt[]>(); // ownerKey -> rows

  // version + emitter
  private version = 0;
  private emitter = new PromptEmitter();

  constructor(providers: ProviderRegistry, list: PromptType[], owner: EntryOwnerRef) {
    // disable auto so subclass fields initialize first
    super('PromptRegistry', providers, list, false);
    this.owner = owner;

    // now it's safe to run the lifecycle
    this.buildGraph();
    this.ready = this.initialize();
  }

  /* -------------------- Build-time: defs + dep checks -------------------- */

  protected override buildMap(list: PromptType[]): RegistryBuildMapResult<PromptRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, PromptRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizePrompt(raw);

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
      const deps = promptDiscoveryDeps(rec);

      for (const d of deps) {
        // Validate against hierarchical providers; throws early if missing
        this.providers.get(d);
        this.graph.get(token)!.add(d);
      }
    }
  }

  /* -------------------- Initialize: create ONE PromptInstance per local prompt -------------------- */

  protected override async initialize(): Promise<void> {
    // Instantiate each local prompt once and store in this.instances
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;

      // Single, authoritative instance per local prompt
      const pi = new PromptInstance(rec, this.providers, this.owner);
      this.instances.set(token as Token<PromptInstance>, pi);

      const lineage: EntryLineage = this.owner ? [this.owner] : [];
      const row = this.makeRow(token, pi, lineage, this);
      this.localRows.push(row);
    }

    // Adopt prompts from child app registries
    const childAppRegistries = this.providers.getRegistries('AppRegistry');
    childAppRegistries.forEach((appRegistry) => {
      const apps = appRegistry.getApps();
      for (const app of apps) {
        const appPromptRegistries = app.providers.getRegistries('PromptRegistry');
        appPromptRegistries
          .filter((r) => r.owner.kind === 'app')
          .forEach((appPromptRegistry) => {
            this.adoptFromChild(appPromptRegistry as PromptRegistry, appPromptRegistry.owner);
          });
      }
    });

    // Adopt prompts from other child prompt registries
    const childPromptRegistries = this.providers.getRegistries('PromptRegistry');
    childPromptRegistries
      .filter((r) => r !== this)
      .forEach((promptRegistry) => {
        this.adoptFromChild(promptRegistry as PromptRegistry, promptRegistry.owner);
      });

    // Build effective indexes from (locals + already adopted children)
    this.reindex();
    this.bump('reset');

    // Register prompt flows with the scope
    const scope = this.providers.getActiveScope();
    await scope.registryFlows(GetPromptFlow, PromptsListFlow);
  }

  /* -------------------- Adoption: reference child instances (no cloning) -------------------- */

  /**
   * Adopt prompts from a child registry. Parent runs after children are ready.
   * We *reference* the child's prompt instances; no duplicates are created.
   */
  adoptFromChild(child: PromptRegistry, _childOwner: EntryOwnerRef): void {
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
   * Get all prompts
   */
  getPrompts(includeHidden = false): PromptEntry[] {
    const all = this.listAllIndexed();
    return all
      .filter((r) => {
        const meta = r.instance.metadata;
        const hidden =
          'hideFromDiscovery' in meta && (meta as { hideFromDiscovery?: boolean }).hideFromDiscovery === true;
        return !hidden || includeHidden;
      })
      .map((r) => r.instance);
  }

  /**
   * Get inline prompts (local only)
   */
  getInlinePrompts(): PromptEntry[] {
    return [...this.instances.values()];
  }

  /**
   * Find a prompt by exact name match
   */
  findByName(name: string): PromptInstance | undefined {
    const rows = this.byName.get(name);
    return rows?.[0]?.instance;
  }

  /**
   * Find all prompts matching a name
   */
  findAllByName(name: string): PromptInstance[] {
    const rows = this.byName.get(name) ?? [];
    return rows.map((r) => r.instance);
  }

  /** Internal snapshot of effective indexed rows (locals + adopted). */
  listAllIndexed(): IndexedPrompt[] {
    return [...this.localRows, ...[...this.adopted.values()].flat()];
  }

  /** List all instances (locals + adopted). */
  listAllInstances(): readonly PromptInstance[] {
    return this.listAllIndexed().map((r) => r.instance);
  }

  /** List instances by owner path (e.g. "app:Portal/plugin:Okta") */
  listByOwner(ownerPath: string): readonly PromptInstance[] {
    return (this.byOwner.get(ownerPath) ?? []).map((r) => r.instance);
  }

  /* -------------------- Indexing & lookups -------------------- */

  private reindex() {
    const effective = this.listAllIndexed();

    this.byQualifiedId.clear();
    this.byName.clear();
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
    }
  }

  /* -------------------- Conflict-aware exported names -------------------- */

  /**
   * Produce unique, MCP-valid exported names.
   */
  exportResolvedNames(opts?: PromptExportOptions): Array<{ name: string; instance: PromptInstance }> {
    const cfg = { ...DEFAULT_PROMPT_EXPORT_OPTS, ...(opts ?? {}) };

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

    const out = new Map<string, PromptInstance>();

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

    function disambiguate(
      candidate: string,
      pool: Map<string, PromptInstance>,
      cfg: Required<PromptExportOptions>,
    ): string {
      if (!pool.has(candidate)) return candidate;
      let n = 2;
      while (n <= MAX_DISAMBIGUATE_ATTEMPTS) {
        const withN = ensureMaxLen(`${candidate}${sepFor(cfg.case)}${n}`, cfg.maxLen);
        if (!pool.has(withN)) return withN;
        n++;
      }
      throw new Error(`Failed to disambiguate name "${candidate}" after ${MAX_DISAMBIGUATE_ATTEMPTS} attempts`);
    }
  }

  /** Lookup by the exported (resolved) name. */
  getExported(name: string, opts?: PromptExportOptions): PromptInstance | undefined {
    const pairs = this.exportResolvedNames(opts);
    return pairs.find((p) => p.name === name)?.instance;
  }

  /* -------------------- Subscriptions -------------------- */

  subscribe(
    opts: { immediate?: boolean; filter?: (i: PromptInstance) => boolean },
    cb: (evt: PromptChangeEvent) => void,
  ): () => void {
    const filter = opts.filter ?? (() => true);
    if (opts.immediate) {
      cb({
        kind: 'reset',
        scope: 'global',
        version: this.version,
        snapshot: this.listAllInstances().filter(filter),
      });
    }
    return this.emitter.on((e) => cb({ ...e, snapshot: this.listAllInstances().filter(filter) }));
  }

  private bump(kind: PromptChangeEvent['kind']) {
    const version = ++this.version;
    this.emitter.emit({ kind, scope: 'global', version, snapshot: this.listAllInstances() });
  }

  /* -------------------- Helpers -------------------- */

  /** Build an IndexedPrompt row */
  private makeRow(
    token: Token,
    instance: PromptInstance,
    lineage: EntryLineage,
    source: PromptRegistry,
  ): IndexedPrompt {
    const ownerKey = ownerKeyOf(lineage);
    const baseName = instance.name;
    const qualifiedName = qualifiedNameOf(lineage, baseName);
    const qualifiedId = `${ownerKey}:${tokenName(token)}`;
    return {
      token,
      instance,
      baseName,
      lineage,
      ownerKey,
      qualifiedName,
      qualifiedId,
      source,
    };
  }

  /** Clone a child row and prepend lineage (with adjacent de-dup to avoid double prefixes). */
  private relineage(row: IndexedPrompt, prepend: EntryLineage): IndexedPrompt {
    const merged = [...prepend, ...row.lineage];
    const lineage = dedupLineage(merged);

    const ownerKey = ownerKeyOf(lineage);
    const qualifiedName = qualifiedNameOf(lineage, row.baseName);
    const qualifiedId = `${ownerKey}:${tokenName(row.token)}`;
    return {
      token: row.token,
      instance: row.instance, // REFERENCE the same instance
      baseName: row.baseName,
      lineage,
      ownerKey,
      qualifiedName,
      qualifiedId,
      source: row.source, // keep original source (who constructed instance)
    };
  }

  /** Best-effort provider id used for prefixing. */
  private providerIdOf(inst: PromptInstance): string | undefined {
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
      // Silently ignore errors - provider ID lookup is best-effort for prefixing
      // and should not fail the overall operation
    }
    return undefined;
  }

  /** True if this registry (or adopted children) has any prompts. */
  hasAny(): boolean {
    return this.listAllIndexed().length > 0 || this.tokens.size > 0;
  }

  /**
   * Get the MCP capabilities for prompts.
   * These are reported to clients during initialization.
   */
  getCapabilities(): Partial<ServerCapabilities> {
    return this.hasAny()
      ? {
          prompts: {
            // List change notifications are only supported when prompts are registered
            listChanged: true,
          },
        }
      : {};
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
