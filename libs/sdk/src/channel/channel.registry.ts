// file: libs/sdk/src/channel/channel.registry.ts

import { Token } from '@frontmcp/di';
import { EntryOwnerRef, ChannelEntry, ChannelRecord, ChannelType, FrontMcpLogger } from '../common';
import { ChannelChangeEvent, ChannelEmitter } from './channel.events';
import ProviderRegistry from '../provider/provider.registry';
import { normalizeChannel } from './channel.utils';
import { RegistryAbstract, RegistryBuildMapResult } from '../regsitry';
import { ChannelInstance } from './channel.instance';
import type { IndexedChannel } from './channel.types';
import type { ServerCapabilities } from '@frontmcp/protocol';

/**
 * Interface for type-safe registry lookups.
 */
export interface ChannelRegistryInterface {
  getChannels(): ChannelEntry[];
  hasAny(): boolean;
}

export default class ChannelRegistry
  extends RegistryAbstract<ChannelInstance, ChannelRecord, ChannelType[]>
  implements ChannelRegistryInterface
{
  /** Who owns this registry */
  owner: EntryOwnerRef;

  /** Channels owned by this registry */
  private localRows: IndexedChannel[] = [];

  /** Version counter for change tracking */
  private version = 0;

  /** Event emitter for change notifications */
  private emitter = new ChannelEmitter();

  /** Logger */
  private logger: FrontMcpLogger;

  constructor(providers: ProviderRegistry, list: ChannelType[], owner: EntryOwnerRef) {
    super('ChannelRegistry', providers, list, false);
    this.owner = owner;
    this.logger = providers.get(FrontMcpLogger).child('ChannelRegistry');

    this.buildGraph();
    this.ready = this.initialize();
  }

  /* -------------------- Build-time -------------------- */

  protected override buildMap(list: ChannelType[]): RegistryBuildMapResult<ChannelRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, ChannelRecord>();
    const graph = new Map<Token, Set<Token>>();
    for (const raw of list) {
      const rec = normalizeChannel(raw);
      const provide = rec.provide;
      tokens.add(provide);
      defs.set(provide, rec);
      graph.set(provide, new Set());
    }
    return { tokens, defs, graph };
  }

  protected buildGraph(): void {
    // Channels have no inter-dependencies
  }

  /* -------------------- Initialize -------------------- */

  protected override async initialize(): Promise<void> {
    for (const token of this.tokens) {
      const rec = this.defs.get(token);
      if (!rec) continue;

      const instance = new ChannelInstance(rec, this.providers, this.owner);
      await instance.ready;

      this.instances.set(token as Token<ChannelInstance>, instance);
      this.localRows.push({
        instance,
        owner: this.owner,
        resolvedName: instance.name,
      });
    }

    if (this.localRows.length > 0) {
      this.logger.info(
        `Initialized ${this.localRows.length} channel(s): ${this.localRows.map((r) => r.resolvedName).join(', ')}`,
      );
    }
  }

  /* -------------------- Query -------------------- */

  /**
   * Get all channel entries.
   */
  getChannels(): ChannelEntry[] {
    return this.localRows.map((r) => r.instance);
  }

  /**
   * Get all channel instances.
   */
  getChannelInstances(): ChannelInstance[] {
    return this.localRows.map((r) => r.instance);
  }

  /**
   * Find a channel by name.
   */
  findByName(name: string): ChannelInstance | undefined {
    return this.localRows.find((r) => r.instance.name === name)?.instance;
  }

  /**
   * Check if any channels are registered.
   */
  hasAny(): boolean {
    return this.localRows.length > 0;
  }

  /**
   * Get the number of registered channels.
   */
  get size(): number {
    return this.localRows.length;
  }

  /* -------------------- Capabilities -------------------- */

  /**
   * Get MCP server capabilities contributed by channels.
   * Returns `experimental: { 'claude/channel': {} }` when channels exist.
   */
  getCapabilities(): Partial<ServerCapabilities> {
    if (!this.hasAny()) return {};
    return {
      experimental: {
        'claude/channel': {},
      },
    };
  }

  /* -------------------- Change Events -------------------- */

  /**
   * Subscribe to channel registry changes.
   */
  subscribe(opts: { immediate?: boolean }, cb: (e: ChannelChangeEvent) => void): () => void {
    const unsub = this.emitter.on(cb);
    if (opts.immediate && this.localRows.length > 0) {
      cb({
        kind: 'reset',
        changeScope: 'global',
        version: this.version,
        snapshot: this.getChannels(),
      });
    }
    return unsub;
  }

  /**
   * Emit a change event.
   */
  bump(kind: ChannelChangeEvent['kind']): void {
    this.version++;
    this.emitter.emit({
      kind,
      changeScope: 'global',
      version: this.version,
      snapshot: this.getChannels(),
    });
  }
}
