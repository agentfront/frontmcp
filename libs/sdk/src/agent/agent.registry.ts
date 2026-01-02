// file: libs/sdk/src/agent/agent.registry.ts

import { EntryLineage, EntryOwnerRef, Token, AgentEntry, AgentRecord, AgentType } from '../common';
import { tokenName } from '../utils';
import { AgentChangeEvent, AgentEmitter } from './agent.events';
import ProviderRegistry from '../provider/provider.registry';
import { normalizeAgent, agentDiscoveryDeps } from './agent.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { AgentInstance } from './agent.instance';
import type { Tool, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { DependencyNotFoundError } from '../errors/mcp.error';

// ============================================================================
// Types
// ============================================================================

/**
 * Indexed agent for lookups.
 */
export interface IndexedAgent {
  token: Token;
  instance: AgentInstance;
  baseName: string;
  lineage: EntryLineage;
  ownerKey: string;
  qualifiedName: string;
  qualifiedId: string;
  source: AgentRegistry;
}

// ============================================================================
// Agent Registry
// ============================================================================

/**
 * Registry for managing agents within a scope.
 *
 * AgentRegistry:
 * - Creates and manages AgentInstance objects
 * - Provides lookup by ID, name, or qualified name
 * - Generates tool definitions for agent invocation
 * - Manages agent visibility in swarms
 * - Supports nested registries (agents inside agents/plugins/apps)
 */
export default class AgentRegistry extends RegistryAbstract<AgentInstance, AgentRecord, AgentType[]> {
  /** Who owns this registry (used for provenance). */
  owner: EntryOwnerRef;

  /** Agents owned/constructed by THIS registry (with lineage applied) */
  private localRows: IndexedAgent[] = [];

  /** Adopted agent rows from each child registry */
  private adopted = new Map<AgentRegistry, IndexedAgent[]>();

  /** Children registries that we track */
  private children = new Set<AgentRegistry>();

  // ---- O(1) indexes over EFFECTIVE set (local + adopted) ----
  private byQualifiedId = new Map<string, IndexedAgent>();
  private byName = new Map<string, IndexedAgent[]>();
  private byOwnerAndName = new Map<string, IndexedAgent>();
  private byOwner = new Map<string, IndexedAgent[]>();
  private byId = new Map<string, IndexedAgent>();

  // version + emitter
  private version = 0;
  private emitter = new AgentEmitter();

  constructor(providers: ProviderRegistry, list: AgentType[], owner: EntryOwnerRef) {
    super('AgentRegistry', providers, list, false);
    this.owner = owner;

    this.buildGraph();
    this.ready = this.initialize();
  }

  // ============================================================================
  // Build-time: defs + dep checks
  // ============================================================================

  protected override buildMap(list: AgentType[]): RegistryBuildMapResult<AgentRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, AgentRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const raw of list) {
      const rec = normalizeAgent(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }

    return { tokens, defs, graph };
  }

  protected buildGraph(): void {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) {
        throw new DependencyNotFoundError('AgentRegistry', tokenName(token));
      }
      const deps = agentDiscoveryDeps(rec);

      for (const d of deps) {
        // Validate against hierarchical providers; throws early if missing
        this.providers.get(d);
        const graphEntry = this.graph.get(token);
        if (!graphEntry) {
          throw new DependencyNotFoundError('AgentRegistry.graph', tokenName(token));
        }
        graphEntry.add(d);
      }
    }
  }

  // ============================================================================
  // Initialize: create one AgentInstance per local agent
  // ============================================================================

  protected override async initialize(): Promise<void> {
    // Instantiate each local agent once
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) {
        throw new DependencyNotFoundError('AgentRegistry', tokenName(token));
      }

      const ai = new AgentInstance(rec, this.providers, this.owner);
      this.instances.set(token as Token<AgentInstance>, ai);

      const lineage: EntryLineage = this.owner ? [this.owner] : [];
      const row = this.makeRow(token, ai, lineage, this);
      this.localRows.push(row);
    }

    // Adopt agents from app registries (similar to ToolRegistry pattern)
    const childAppRegistries = this.providers.getRegistries('AppRegistry');
    childAppRegistries.forEach((appRegistry) => {
      const apps = appRegistry.getApps();
      for (const app of apps) {
        const appAgentRegistries = app.providers.getRegistries('AgentRegistry');
        appAgentRegistries
          .filter((r) => r.owner.kind === 'app')
          .forEach((appAgentRegistry) => {
            this.adoptFromChild(appAgentRegistry as AgentRegistry, appAgentRegistry.owner);
          });
      }
    });

    // Adopt from other child agent registries (e.g., plugins)
    const childAgentRegistries = this.providers.getRegistries('AgentRegistry');
    childAgentRegistries
      .filter((r) => r !== this)
      .forEach((agentRegistry) => {
        this.adoptFromChild(agentRegistry as AgentRegistry, agentRegistry.owner);
      });

    // Build effective indexes
    this.reindex();
    this.bump('reset');

    // Wait for all agent instances to be ready
    await Promise.all([...this.instances.values()].map((ai) => ai.ready));
  }

  // ============================================================================
  // Adoption: reference child instances
  // ============================================================================

  /**
   * Adopt agents from a child registry.
   */
  adoptFromChild(child: AgentRegistry, _childOwner: EntryOwnerRef): void {
    if (this.children.has(child)) return;

    const childRows = child.listAllIndexed();
    const prepend: EntryLineage = this.owner ? [this.owner] : [];

    const adoptedRows = childRows.map((r) => this.relineage(r, prepend));

    this.adopted.set(child, adoptedRows);
    this.children.add(child);

    // Keep live if child changes
    child.subscribe({ immediate: false }, () => {
      const latest = child.listAllIndexed().map((r) => this.relineage(r, prepend));
      this.adopted.set(child, latest);
      this.reindex();
      this.bump('reset');
    });

    this.reindex();
    this.bump('reset');
  }

  // ============================================================================
  // Accessors
  // ============================================================================

  /**
   * Get all agents (local + adopted).
   */
  // NOTE: `any` is intentional - heterogeneous agent collections
  getAgents(includeHidden = false): AgentEntry<any, any>[] {
    const local = [...this.localRows].map((a) => a.instance);
    const adopted = [...this.adopted.values()].flat().map((a) => a.instance);
    return [...local, ...adopted].filter((a) => a.metadata.hideFromDiscovery !== true || includeHidden);
  }

  /**
   * Get only agents defined inline in this registry.
   */
  // NOTE: `any` is intentional - see getAgents comment
  getInlineAgents(): AgentEntry<any, any>[] {
    return [...this.instances.values()];
  }

  /**
   * Internal snapshot of effective indexed rows (locals + adopted).
   */
  private listAllIndexed(): IndexedAgent[] {
    return [...this.localRows, ...[...this.adopted.values()].flat()];
  }

  /**
   * List all instances (locals + adopted).
   */
  listAllInstances(): readonly AgentInstance[] {
    return this.listAllIndexed().map((r) => r.instance);
  }

  /**
   * Find an agent by ID.
   */
  findById(id: string): AgentInstance | undefined {
    return this.byId.get(id)?.instance;
  }

  /**
   * Find an agent by name.
   */
  findByName(name: string): AgentInstance | undefined {
    const rows = this.byName.get(name);
    return rows?.[0]?.instance;
  }

  /**
   * Get agents visible to a specific agent.
   *
   * @param agentId - The ID of the agent that wants to see others
   * @returns Array of agents visible to the specified agent
   */
  getVisibleAgentsFor(agentId: string): AgentInstance[] {
    const agent = this.findById(agentId);
    if (!agent) return [];

    const canSeeSwarm = agent.canSeeSwarm();
    if (!canSeeSwarm) return [];

    const visibleIds = agent.getVisibleAgentIds();
    const allAgents = this.listAllInstances();

    return allAgents.filter((a) => {
      // Don't include self
      if (a.id === agentId) return false;

      // Must be visible to swarm
      if (!a.isVisibleToSwarm()) return false;

      // If whitelist is specified, only include those
      if (visibleIds && visibleIds.length > 0) {
        return visibleIds.includes(a.id);
      }

      return true;
    });
  }

  /**
   * Get tool definitions for all agents.
   *
   * Each agent is exposed as a tool with name `use-agent:<agent_id>`.
   */
  getAgentsAsTools(): Tool[] {
    return this.listAllInstances()
      .filter((a) => a.isVisibleToSwarm())
      .map((a) => a.getToolDefinition());
  }

  /**
   * Get tool definitions for agents visible to a specific agent.
   */
  getAgentToolsFor(agentId: string): Tool[] {
    return this.getVisibleAgentsFor(agentId).map((a) => a.getToolDefinition());
  }

  // ============================================================================
  // Indexing
  // ============================================================================

  private reindex(): void {
    const effective = this.listAllIndexed();

    this.byQualifiedId.clear();
    this.byName.clear();
    this.byOwnerAndName.clear();
    this.byOwner.clear();
    this.byId.clear();

    for (const r of effective) {
      this.byQualifiedId.set(r.qualifiedId, r);
      this.byId.set(r.instance.id, r);

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

  // ============================================================================
  // Subscriptions
  // ============================================================================

  subscribe(
    opts: { immediate?: boolean; filter?: (i: AgentInstance) => boolean },
    cb: (evt: AgentChangeEvent) => void,
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

  private bump(kind: AgentChangeEvent['kind']): void {
    const version = ++this.version;
    this.emitter.emit({ kind, changeScope: 'global', version, snapshot: this.listAllInstances() });
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private makeRow(token: Token, instance: AgentInstance, lineage: EntryLineage, source: AgentRegistry): IndexedAgent {
    const ownerKey = ownerKeyOf(lineage);
    const baseName = instance.name;
    const qualifiedName = qualifiedNameOf(lineage, baseName);
    const qualifiedId = `${ownerKey}:${tokenName(token)}`;
    return { token, instance, baseName, lineage, ownerKey, qualifiedName, qualifiedId, source };
  }

  private relineage(row: IndexedAgent, prepend: EntryLineage): IndexedAgent {
    const merged = [...prepend, ...row.lineage];
    const lineage = dedupLineage(merged);

    const ownerKey = ownerKeyOf(lineage);
    const qualifiedName = qualifiedNameOf(lineage, row.baseName);
    const qualifiedId = `${ownerKey}:${tokenName(row.token)}`;

    return {
      token: row.token,
      instance: row.instance,
      baseName: row.baseName,
      lineage,
      ownerKey,
      qualifiedName,
      qualifiedId,
      source: row.source,
    };
  }

  /**
   * True if this registry (or adopted children) has any agents.
   */
  hasAny(): boolean {
    return this.listAllIndexed().length > 0 || this.tokens.size > 0;
  }

  /**
   * Get the MCP capabilities for agents.
   */
  getCapabilities(): Partial<ServerCapabilities> {
    // Agents are exposed as tools, so their capabilities are part of tools
    return this.hasAny()
      ? {
          tools: {
            listChanged: true,
          },
        }
      : {};
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function ownerKeyOf(lineage: EntryLineage): string {
  return lineage.map((o) => `${o.kind}:${o.id}`).join('/');
}

function qualifiedNameOf(lineage: EntryLineage, baseName: string): string {
  const prefix = lineage.map((o) => o.id).join('.');
  return prefix ? `${prefix}.${baseName}` : baseName;
}

function dedupLineage(l: EntryLineage): EntryLineage {
  const out: EntryLineage = [];
  for (const o of l) {
    const last = out[out.length - 1];
    if (!last || last.kind !== o.kind || last.id !== o.id) out.push(o);
  }
  return out;
}
