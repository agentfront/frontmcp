/**
 * Base class for registries with indexed lookups.
 *
 * Provides:
 * - O(1) lookups by qualified ID, name, owner
 * - Child registry adoption with live subscriptions
 * - Lineage management for tracking ownership
 * - Change event emission for subscribers
 *
 * Extended by ToolRegistry, ResourceRegistry, PromptRegistry, AgentRegistry.
 */

import type { Token } from '../interfaces/base.interface.js';
import { RegistryAbstract, type RegistryBuildMapResult, type RegistryKind } from './registry.base.js';
import type {
  IndexedEntry,
  EntryLineage,
  EntryOwnerRef,
  LineageSegment,
  ChangeEvent,
  ChangeKind,
  SubscribeOptions,
  RegistryEmitter,
} from './indexed.types.js';

/**
 * Abstract base class for registries with indexed lookups.
 *
 * @typeParam TInstance - Type of registry entry instances
 * @typeParam TRecord - Type of registry records
 * @typeParam TIndexed - Type of indexed entries (extends IndexedEntry)
 * @typeParam TMetadata - Type of initialization metadata
 * @typeParam TProviders - Type of parent provider registry
 */
export abstract class IndexedRegistry<
  TInstance,
  TRecord,
  TIndexed extends IndexedEntry<TInstance>,
  TMetadata,
  TProviders = unknown,
> extends RegistryAbstract<TInstance, TRecord, TMetadata, TProviders> {
  /* -------------------- Local vs. Adopted -------------------- */

  /** Entries created by this registry */
  protected localRows: TIndexed[] = [];

  /** Entries adopted from child registries */
  protected adopted = new Map<IndexedRegistry<TInstance, TRecord, TIndexed, any, any>, TIndexed[]>();

  /** Set of child registries */
  protected children = new Set<IndexedRegistry<TInstance, TRecord, TIndexed, any, any>>();

  /** Unsubscribe functions for child subscriptions */
  protected childSubscriptions = new Map<IndexedRegistry<TInstance, TRecord, TIndexed, any, any>, () => void>();

  /* -------------------- Common Indexes -------------------- */

  /** O(1) lookup by qualified ID */
  protected byQualifiedId = new Map<string, TIndexed>();

  /** O(1) lookup by base name (array for conflicts) */
  protected byName = new Map<string, TIndexed[]>();

  /** O(1) lookup by owner key */
  protected byOwner = new Map<string, TIndexed[]>();

  /** O(1) lookup by owner:name composite */
  protected byOwnerAndName = new Map<string, TIndexed>();

  /* -------------------- Change Events -------------------- */

  /** Version counter for change tracking */
  protected version = 0;

  /** Event emitter for change notifications */
  protected emitter: RegistryEmitter<ChangeEvent<TIndexed>>;

  /**
   * Create an event emitter for this registry.
   * Override to use custom emitter implementation.
   */
  protected createEmitter(): RegistryEmitter<ChangeEvent<TIndexed>> {
    const handlers = new Set<(event: ChangeEvent<TIndexed>) => void>();
    return {
      emit: (event) => handlers.forEach((h) => h(event)),
      on: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
    };
  }

  protected constructor(name: RegistryKind, providers: TProviders, metadata: TMetadata, auto = true) {
    super(name, providers, metadata, auto);
    this.emitter = this.createEmitter();
  }

  /* -------------------- Abstract Methods -------------------- */

  /**
   * Build additional indexes from rows.
   * Called during reindex to populate custom indexes.
   *
   * @param rows - All indexed entries (local + adopted)
   */
  protected abstract buildIndexes(rows: TIndexed[]): void;

  /**
   * Create an indexed entry from a record.
   * Called during initialization to wrap records.
   *
   * @param token - Entry token
   * @param record - Entry record
   * @param instance - Instantiated entry
   * @returns Indexed entry wrapper
   */
  protected abstract makeRow(token: Token, record: TRecord, instance: TInstance): TIndexed;

  /* -------------------- Adoption -------------------- */

  /**
   * Adopt entries from a child registry.
   *
   * @param child - Child registry to adopt from
   * @param childOwner - Owner reference for lineage
   */
  adoptFromChild(child: IndexedRegistry<TInstance, TRecord, TIndexed, any, any>, childOwner: EntryOwnerRef): void {
    // Get child's entries and relineage them
    const childRows = child.listAllIndexed();
    const adoptedRows = childRows.map((r) => this.relineage(r, childOwner.lineage));

    this.adopted.set(child, adoptedRows);
    this.children.add(child);

    // Subscribe to child changes for live updates
    const unsubscribe = child.subscribe({ immediate: false }, () => {
      const latest = child.listAllIndexed().map((r) => this.relineage(r, childOwner.lineage));
      this.adopted.set(child, latest);
      this.reindex();
      this.bump('reset');
    });

    this.childSubscriptions.set(child, unsubscribe);
    this.reindex();
    this.bump('reset');
  }

  /**
   * Remove a child registry.
   */
  removeChild(child: IndexedRegistry<TInstance, TRecord, TIndexed, any, any>): void {
    const unsub = this.childSubscriptions.get(child);
    if (unsub) unsub();
    this.childSubscriptions.delete(child);
    this.children.delete(child);
    this.adopted.delete(child);
    this.reindex();
    this.bump('reset');
  }

  /* -------------------- Lineage -------------------- */

  /**
   * Relineage an entry with a new prefix.
   * Creates a new indexed entry with updated lineage.
   */
  protected relineage(row: TIndexed, prepend: EntryLineage): TIndexed {
    const merged = [...prepend, ...row.lineage];
    const lineage = this.dedupLineage(merged);
    const ownerKey = this.ownerKeyOf(lineage);
    const qualifiedName = this.qualifiedNameOf(row.baseName, lineage);
    const qualifiedId = `${ownerKey}:${row.token.toString()}`;

    return {
      ...row,
      lineage,
      ownerKey,
      qualifiedName,
      qualifiedId,
    };
  }

  /**
   * Remove adjacent duplicate segments from lineage.
   */
  protected dedupLineage(lineage: EntryLineage): EntryLineage {
    const result: EntryLineage = [];
    for (const seg of lineage) {
      const last = result[result.length - 1];
      if (!last || last.type !== seg.type || last.id !== seg.id) {
        result.push(seg);
      }
    }
    return result;
  }

  /**
   * Generate owner key from lineage.
   */
  protected ownerKeyOf(lineage: EntryLineage): string {
    return lineage.map((s) => `${s.type}:${s.id}`).join('/');
  }

  /**
   * Generate qualified name from base name and lineage.
   */
  protected qualifiedNameOf(baseName: string, lineage: EntryLineage): string {
    const prefix = lineage.map((s) => s.name || s.id).join('/');
    return prefix ? `${prefix}/${baseName}` : baseName;
  }

  /* -------------------- Indexing -------------------- */

  /**
   * Rebuild all indexes from local and adopted entries.
   */
  protected reindex(): void {
    // Collect all rows
    const allRows = [...this.localRows];
    for (const rows of this.adopted.values()) {
      allRows.push(...rows);
    }

    // Clear common indexes
    this.byQualifiedId.clear();
    this.byName.clear();
    this.byOwner.clear();
    this.byOwnerAndName.clear();

    // Build common indexes
    for (const row of allRows) {
      this.byQualifiedId.set(row.qualifiedId, row);

      const nameList = this.byName.get(row.baseName) ?? [];
      nameList.push(row);
      this.byName.set(row.baseName, nameList);

      const ownerList = this.byOwner.get(row.ownerKey) ?? [];
      ownerList.push(row);
      this.byOwner.set(row.ownerKey, ownerList);

      const ownerNameKey = `${row.ownerKey}:${row.baseName}`;
      this.byOwnerAndName.set(ownerNameKey, row);
    }

    // Build custom indexes
    this.buildIndexes(allRows);
  }

  /* -------------------- Change Events -------------------- */

  /**
   * Subscribe to change events.
   */
  subscribe(opts: SubscribeOptions<TInstance>, callback: (event: ChangeEvent<TIndexed>) => void): () => void {
    if (opts.immediate) {
      callback({
        kind: 'reset',
        changeScope: 'global',
        version: this.version,
        snapshot: this.listAllIndexed(),
      });
    }

    return this.emitter.on((e) => {
      if (opts.filter) {
        const filtered = e.snapshot.filter((row) => opts.filter!(row.instance));
        callback({ ...e, snapshot: filtered });
      } else {
        callback(e);
      }
    });
  }

  /**
   * Emit a change event.
   */
  protected bump(kind: ChangeKind): void {
    const version = ++this.version;
    this.emitter.emit({
      kind,
      changeScope: 'global',
      version,
      snapshot: this.listAllIndexed(),
    });
  }

  /* -------------------- Lookups -------------------- */

  /**
   * Find by base name (returns first match).
   */
  findByName(name: string): TInstance | undefined {
    const rows = this.byName.get(name);
    return rows?.[0]?.instance;
  }

  /**
   * Find all by base name.
   */
  findAllByName(name: string): TInstance[] {
    const rows = this.byName.get(name);
    return rows?.map((r) => r.instance) ?? [];
  }

  /**
   * Find by qualified ID.
   */
  findByQualifiedId(qualifiedId: string): TInstance | undefined {
    return this.byQualifiedId.get(qualifiedId)?.instance;
  }

  /**
   * List all indexed entries by owner.
   */
  listByOwner(ownerKey: string): TIndexed[] {
    return this.byOwner.get(ownerKey) ?? [];
  }

  /**
   * List all indexed entries.
   */
  listAllIndexed(): TIndexed[] {
    const all: TIndexed[] = [...this.localRows];
    for (const rows of this.adopted.values()) {
      all.push(...rows);
    }
    return all;
  }

  /**
   * List all instances.
   */
  listAllInstances(): TInstance[] {
    return this.listAllIndexed().map((r) => r.instance);
  }

  /**
   * Check if registry has any entries.
   */
  override hasAny(): boolean {
    return this.localRows.length > 0 || this.adopted.size > 0;
  }

  /* -------------------- Cleanup -------------------- */

  /**
   * Dispose of this registry and clean up subscriptions.
   */
  dispose(): void {
    for (const unsub of this.childSubscriptions.values()) {
      unsub();
    }
    this.childSubscriptions.clear();
    this.children.clear();
    this.adopted.clear();
  }
}
