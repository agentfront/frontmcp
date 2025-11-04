import { Token, ToolEntry, ToolRecord, ToolRegistryInterface, ToolType } from '@frontmcp/sdk';
import { getMetadata } from '../utils/metadata.utils';
import { ToolChangeEvent, ToolEmitter } from './tool.events';
import ProviderRegistry from '../provider/provider.registry';
import { normalizeTool, toolDiscoveryDeps } from './tool.utils';
import { tokenName } from '../utils/token.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { ToolInstance } from './tool.instance';

/** Provenance identity for a registry owner */
type OwnerKind = 'scope' | 'app' | 'plugin' | 'adapter';
export type OwnerRef = { kind: OwnerKind; id: string; ref: Token };
type Lineage = OwnerRef[]; // root -> leaf; e.g. [{kind:'app', id:'Portal'}, {kind:'plugin', id:'Okta'}]

/** Internal augmented row: instance + provenance + token */
type IndexedTool = {
  token: Token;
  instance: ToolInstance;
  /** base tool name from metadata (unmodified) */
  baseName: string;
  /** lineage & qualified info */
  lineage: Lineage;
  ownerKey: string;       // "app:Portal/plugin:Okta"
  qualifiedName: string;  // "app:Portal/plugin:Okta:toolName"
  qualifiedId: string;    // "app:Portal/plugin:Okta:tokenName(<token>)"
  /** which registry constructed the instance (the “owner” registry) */
  source: ToolRegistry;
};

/* -------------------- naming options & helpers (MCP constraints) -------------------- */

type NameCase = 'snake' | 'camel' | 'kebab' | 'dot';
type ExportNameOptions = {
  case?: NameCase;                        // default 'snake'
  maxLen?: number;                        // default 64
  prefixChildrenOnConflict?: boolean;     // default true
  prefixSource?: 'provider' | 'owner';    // default 'provider'
};

const DEFAULT_EXPORT_OPTS: Required<ExportNameOptions> = {
  case: 'snake',
  maxLen: 64,
  prefixChildrenOnConflict: true,
  prefixSource: 'provider',
};

// Allowed chars per MCP spec: a-zA-Z0-9 _ - . /
const MCP_ALLOWED = /[A-Za-z0-9_\-\.\/]/;

function splitWords(input: string): string[] {
  const parts: string[] = [];
  let buff = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const isAlphaNum = /[A-Za-z0-9]/.test(ch);
    if (!isAlphaNum) {
      if (buff) {
        parts.push(buff);
        buff = '';
      }
      continue;
    }
    if (buff && /[a-z]/.test(buff[buff.length - 1]) && /[A-Z]/.test(ch)) {
      parts.push(buff);
      buff = ch;
    } else {
      buff += ch;
    }
  }
  if (buff) parts.push(buff);
  return parts;
}

function toCase(words: string[], kind: NameCase): string {
  const safe = words.filter(Boolean);
  switch (kind) {
    case 'snake':
      return safe.map(w => w.toLowerCase()).join('_');
    case 'kebab':
      return safe.map(w => w.toLowerCase()).join('-');
    case 'dot':
      return safe.map(w => w.toLowerCase()).join('.');
    case 'camel':
      if (safe.length === 0) return '';
      return safe[0].toLowerCase() + safe.slice(1)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  }
}

function normalizeSegment(raw: string, kind: NameCase): string {
  const words = splitWords(raw);
  let cased = toCase(words, kind);
  cased = [...cased].filter(ch => MCP_ALLOWED.test(ch)).join('');
  return cased || 'x';
}

function normalizeProviderId(raw: string | undefined, kind: NameCase): string | undefined {
  if (!raw) return undefined;
  const tokens = raw.split(/[^\w]+/);
  const cased = toCase(tokens, kind);
  const safe = [...cased].filter(ch => MCP_ALLOWED.test(ch)).join('');
  return safe || undefined;
}

function normalizeOwnerPath(ownerKey: string, kind: NameCase): string {
  const levels = ownerKey.split('/');
  const normLevels = levels.map(level => {
    const parts = level.split(':'); // ["app","Portal"]
    return parts.map(p => normalizeSegment(p, kind)).join(
      kind === 'snake' ? '_' : kind === 'kebab' ? '-' : kind === 'dot' ? '.' : '',
    );
  });
  if (kind === 'camel') return normLevels.map(seg => seg.charAt(0).toLowerCase() + seg.slice(1)).join('');
  const sep = kind === 'snake' ? '_' : kind === 'kebab' ? '-' : '.';
  return normLevels.join(sep);
}

function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(16).slice(-6).padStart(6, '0');
}

function ensureMaxLen(name: string, max: number): string {
  if (name.length <= max) return name;
  const hash = shortHash(name);
  const lastSep = Math.max(name.lastIndexOf('_'), name.lastIndexOf('-'), name.lastIndexOf('.'), name.lastIndexOf('/'));
  const tail = lastSep > 0 ? name.slice(lastSep + 1) : name.slice(-Math.max(3, Math.min(16, Math.floor(max / 4))));
  const budget = Math.max(1, max - (1 + hash.length + 1 + tail.length));
  const prefix = name.slice(0, budget);
  return `${prefix}-${hash}-${tail}`.slice(0, max);
}

function sepFor(kind: NameCase): string {
  return kind === 'snake' ? '_' : kind === 'kebab' ? '-' : kind === 'dot' ? '.' : '';
}

function ownerKeyOf(lineage: Lineage): string {
  return lineage.map(o => `${o.kind}:${o.id}`).join('/');
}

function qualifiedNameOf(lineage: Lineage, name: string): string {
  return `${ownerKeyOf(lineage)}:${name}`;
}

/* -------------------- ToolRegistry (instances + hierarchy + conflicts) -------------------- */

export default class ToolRegistry extends RegistryAbstract<
  ToolInstance,        // IMPORTANT: instances map holds ToolInstance (not the interface)
  ToolRecord,
  ToolType[]
> implements ToolRegistryInterface {
  /** Who owns this registry (used for provenance). Optional. */
  owner: OwnerRef;

  /** Tools truly owned/constructed by THIS registry (with lineage applied) */
  private localRows: IndexedTool[] = [];

  /** Adopted tool rows from each child registry (references to the same instances) */
  private adopted = new Map<ToolRegistry, IndexedTool[]>();

  /** Children registries that we track */
  private children = new Set<ToolRegistry>();

  // ---- O(1) indexes over EFFECTIVE set (local + adopted) ----
  private byQualifiedId = new Map<string, IndexedTool>();        // qualifiedId -> row
  private byName = new Map<string, IndexedTool[]>();             // baseName -> rows
  private byOwnerAndName = new Map<string, IndexedTool>();       // "ownerKey:name" -> row
  private byProviderAndName = new Map<string, IndexedTool>();    // "providerId:name" -> row (best-effort)
  private byOwner = new Map<string, IndexedTool[]>();            // ownerKey -> rows

  // version + emitter
  private version = 0;
  private emitter = new ToolEmitter();

  constructor(providers: ProviderRegistry, list: ToolType[], owner: OwnerRef) {
    // disable auto so subclass fields initialize first
    super('ToolRegistry', providers, list, false);
    this.owner = owner;

    // now it’s safe to run the lifecycle
    this.buildGraph();
    this.ready = this.initialize();
  }

  /* -------------------- Build-time: defs + dep checks -------------------- */

  protected override buildMap(list: ToolType[]): RegistryBuildMapResult<ToolRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, ToolRecord>();
    const graph = new Map<Token, Set<Token>>();
    for (const raw of list) {
      const rec = normalizeTool(raw);
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
      const deps = toolDiscoveryDeps(rec);

      for (const d of deps) {
        // Validate against hierarchical providers; throws early if missing
        this.providers.get(d);
        this.graph.get(token)!.add(d);
      }
    }
  }

  /* -------------------- Initialize: create ONE FrontMcpToolInstance per local tool -------------------- */

  protected override async initialize(): Promise<void> {
    // Instantiate each local tool once and store in this.instances (from RegistryAbstract)
    for (const token of this.tokens) {
      const rec = this.defs.get(token)!;

      // Single, authoritative instance per local tool
      const ti = new ToolInstance(rec, this.providers);
      this.instances.set(token as Token<ToolInstance>, ti);

      // Apply provenance (owner lineage if provided)
      const lineage: Lineage = this.owner ? [this.owner] : [];
      const row = this.makeRow(token, ti, lineage, this);
      this.localRows.push(row);
    }

    const childAppRegistries = this.providers.getRegistries('AppRegistry');
    childAppRegistries.forEach(childAppRegistry => {
      const apps = childAppRegistry.getApps();
      for (const app of apps) {
        //  get app tools and adopt them as owner app owne
        //  register's provided tools inside the app
      }
    });

    const childRegistries = this.providers.getRegistries('ToolRegistry');
    childRegistries.filter(t => t != this).forEach(childRegistry => {
      this.adoptFromChild(childRegistry as ToolRegistry, childRegistry.owner);
    });

    // Build effective indexes from (locals + already adopted children)
    this.reindex();
    this.bump('reset');
  }

  /* -------------------- Adoption: reference child instances (no cloning) -------------------- */

  /**
   * Adopt tools from a child registry. Parent runs after children are ready.
   * We *reference* the child's tool instances; no duplicates are created.
   *
   * IMPORTANT:
   * - Child rows already include the child's own lineage (e.g., adapter:openapi).
   * - Here we only prepend the **parent's** owner, to avoid double-prefixing the child.
   */
  adoptFromChild(child: ToolRegistry, _childOwner: OwnerRef): void {
    if (this.children.has(child)) return;

    const childRows = child.listAllIndexed(); // includes child's lineage
    const prepend: Lineage = this.owner ? [this.owner] : [];

    const adoptedRows = childRows.map(r => this.relineage(r, prepend));

    this.adopted.set(child, adoptedRows);
    this.children.add(child);

    // keep live if child changes
    child.subscribe({ immediate: false }, () => {
      const latest = child.listAllIndexed().map(r => this.relineage(r, prepend));
      this.adopted.set(child, latest);
      this.reindex();
      this.bump('reset');
    });

    this.reindex();
    this.bump('reset');
  }

  getTools(): ToolEntry<any, any>[] {
    const local = [...this.localRows].flat().map(t => t.instance);
    const adopted = [...this.adopted.values()].flat().map(t => t.instance);
    return [...local, ...adopted];
  }

  getInlineTools(): ToolEntry<any, any>[] {
    return [...this.instances.values()];
  }

  /** Internal snapshot of effective indexed rows (locals + adopted). */
  private listAllIndexed(): IndexedTool[] {
    return [...this.localRows, ...[...this.adopted.values()].flat()];
  }

  /* -------------------- Indexing & lookups -------------------- */

  private reindex() {
    const effective = this.listAllIndexed();

    this.byQualifiedId.clear();
    this.byName.clear();
    this.byOwnerAndName.clear();
    this.byProviderAndName.clear();
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

      const provId = this.providerIdOf(r.instance);
      if (provId) {
        const pn = `${provId}:${r.baseName}`;
        if (!this.byProviderAndName.has(pn)) this.byProviderAndName.set(pn, r);
      }
    }
  }

  /** List all instances (locals + adopted). */
  listAllInstances(): readonly ToolInstance[] {
    return this.listAllIndexed().map(r => r.instance);
  }

  /** List instances by owner path (e.g. "app:Portal/plugin:Okta") */
  listByOwner(ownerPath: string): readonly ToolInstance[] {
    return (this.byOwner.get(ownerPath) ?? []).map(r => r.instance);
  }

  /* -------------------- Conflict-aware exported names -------------------- */

  /**
   * Produce unique, MCP-valid exported names.
   * - Base (standardized) = metadata.name cased (snake/camel/kebab/dot)
   * - If conflicting:
   *    - Locals keep bare base (unless >1 locals conflict → they get owner prefixes)
   *    - Children with same base get prefixed by providerId (or owner path)
   */
  exportResolvedNames(opts?: ExportNameOptions): Array<{ name: string; instance: ToolInstance }> {
    const cfg = { ...DEFAULT_EXPORT_OPTS, ...(opts ?? {}) };

    const rows = this.listAllIndexed().map(r => {
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

    const out = new Map<string, ToolInstance>();

    for (const [base, group] of byBase.entries()) {
      if (group.length === 1) {
        const g = group[0];
        out.set(ensureMaxLen(base, cfg.maxLen), g.row.instance);
        continue;
      }

      const locals = group.filter(g => g.isLocal);
      const children = group.filter(g => !g.isLocal);

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
          const pre = cfg.prefixSource === 'provider'
            ? (c.provider ?? c.ownerPath)
            : c.ownerPath;
          const name = ensureMaxLen(`${pre}${sepFor(cfg.case)}${base}`, cfg.maxLen);
          out.set(disambiguate(name, out, cfg), c.row.instance);
        }
      } else {
        // Prefix everyone by source
        for (const r of group) {
          const pre = cfg.prefixSource === 'provider'
            ? (r.provider ?? r.ownerPath)
            : r.ownerPath;
          const name = ensureMaxLen(`${pre}${sepFor(cfg.case)}${base}`, cfg.maxLen);
          out.set(disambiguate(name, out, cfg), r.row.instance);
        }
      }
    }

    return [...out.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, instance]) => ({ name, instance }));

    function disambiguate(candidate: string, pool: Map<string, any>, cfg: Required<ExportNameOptions>): string {
      if (!pool.has(candidate)) return candidate;
      let n = 2;
      while (true) {
        const withN = ensureMaxLen(`${candidate}${sepFor(cfg.case)}${n}`, cfg.maxLen);
        if (!pool.has(withN)) return withN;
        n++;
      }
    }
  }

  /** Lookup by the exported (resolved) name. */
  getExported(name: string, opts?: ExportNameOptions): ToolInstance | undefined {
    const pairs = this.exportResolvedNames(opts);
    return pairs.find(p => p.name === name)?.instance;
  }

  /* -------------------- Subscriptions -------------------- */

  subscribe(
    opts: { immediate?: boolean; filter?: (i: ToolInstance) => boolean },
    cb: (evt: ToolChangeEvent) => void,
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

  private bump(kind: ToolChangeEvent['kind']) {
    const version = ++this.version;
    this.emitter.emit({ kind, scope: 'global', version, snapshot: this.listAllInstances() });
  }

  /* -------------------- Helpers -------------------- */

  /** Build an IndexedTool row */
  private makeRow(token: Token, instance: ToolInstance, lineage: Lineage, source: ToolRegistry): IndexedTool {
    const ownerKey = ownerKeyOf(lineage);
    const baseName = instance.name;
    const qualifiedName = qualifiedNameOf(lineage, baseName);
    const qualifiedId = `${ownerKey}:${tokenName(token)}`;
    return { token, instance, baseName, lineage, ownerKey, qualifiedName, qualifiedId, source };
  }

  /** Clone a child row and prepend lineage (with adjacent de-dup to avoid double prefixes). */
  private relineage(row: IndexedTool, prepend: Lineage): IndexedTool {
    const merged = [...prepend, ...row.lineage];
    const lineage = dedupLineage(merged);

    const ownerKey = ownerKeyOf(lineage);
    const qualifiedName = qualifiedNameOf(lineage, row.baseName);
    const qualifiedId = `${ownerKey}:${tokenName(row.token)}`;
    return {
      token: row.token,
      instance: row.instance,      // REFERENCE the same instance
      baseName: row.baseName,
      lineage,
      ownerKey,
      qualifiedName,
      qualifiedId,
      source: row.source,          // keep original source (who constructed instance)
    };
  }

  /** Best-effort provider id used for prefixing (inspects class metadata if present). */
  private providerIdOf(inst: ToolInstance): string | undefined {
    // Try reading provider id from the tool class metadata (if your decorators set one)
    try {
      const meta: any = inst.getMetadata?.();
      const maybe = meta?.providerId ?? meta?.provider ?? meta?.ownerId ?? undefined;
      if (typeof maybe === 'string' && maybe.length) return maybe;

      const cls: any = (meta && meta.cls) ? meta.cls : undefined;
      if (cls) {
        const id = getMetadata('id', cls);
        if (typeof id === 'string' && id.length) return id;
        if (cls.name) return cls.name;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  }

  /** True if this registry (or adopted children) has any tools. */
  hasAny(): boolean {
    return this.listAllIndexed().length > 0 || this.tokens.size > 0;
  }
}

/* -------------------- lineage utility -------------------- */

/** Remove only adjacent duplicates like [adapter:x, adapter:x] → [adapter:x] */
function dedupLineage(l: Lineage): Lineage {
  const out: Lineage = [];
  for (const o of l) {
    const last = out[out.length - 1];
    if (!last || last.kind !== o.kind || last.id !== o.id) out.push(o);
  }
  return out;
}
