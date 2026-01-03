/**
 * Tests for IndexedRegistry.
 */

import 'reflect-metadata';
import { IndexedRegistry } from '../registry/indexed.registry.js';
import type { IndexedEntry, EntryLineage, EntryOwnerRef, ChangeEvent } from '../registry/indexed.types.js';
import type { RegistryBuildMapResult } from '../registry/registry.base.js';
import type { Token } from '../interfaces/base.interface.js';

// Test types
interface TestInstance {
  id: string;
  name: string;
}

interface TestRecord {
  id: string;
  name: string;
  data?: any;
}

type TestIndexed = IndexedEntry<TestInstance>;

// Concrete implementation for testing
class TestIndexedRegistry extends IndexedRegistry<TestInstance, TestRecord, TestIndexed, TestRecord[], undefined> {
  // Additional test-specific index
  protected byId = new Map<string, TestIndexed>();

  // Owner reference for this registry - initialized before super()
  private registryOwnerRef: EntryOwnerRef = {
    lineage: [],
    ownerKey: 'root',
  };

  constructor(records: TestRecord[] = [], ownerRef?: EntryOwnerRef) {
    // Set ownerRef before calling super() since initialize() may be called
    super('TestRegistry', undefined, records, false);
    if (ownerRef) {
      this.registryOwnerRef = ownerRef;
    }
    // Manually trigger init
    this.buildGraph();
    this.ready = this.initialize();
  }

  protected buildMap(records: TestRecord[]): RegistryBuildMapResult<TestRecord> {
    const tokens = new Set<Token>();
    const defs = new Map<Token, TestRecord>();
    const graph = new Map<Token, Set<Token>>();

    for (const rec of records) {
      const token = Symbol(rec.id);
      tokens.add(token);
      defs.set(token, rec);
      graph.set(token, new Set());
    }

    return { tokens, defs, graph };
  }

  protected buildGraph(): void {
    // No dependencies in test
  }

  protected async initialize(): Promise<void> {
    for (const [token, rec] of this.defs) {
      const instance: TestInstance = { id: rec.id, name: rec.name };
      this.instances.set(token, instance);

      const indexed = this.makeRow(token, rec, instance);
      this.localRows.push(indexed);
    }

    this.reindex();
  }

  protected makeRow(token: Token, rec: TestRecord, instance: TestInstance): TestIndexed {
    const lineage = this.registryOwnerRef.lineage;
    const ownerKey = this.registryOwnerRef.ownerKey;

    return {
      token,
      instance,
      baseName: rec.name,
      lineage,
      ownerKey,
      qualifiedName: lineage.length > 0 ? `${lineage.map((s) => s.name || s.id).join('/')}/${rec.name}` : rec.name,
      qualifiedId: `${ownerKey}:${rec.id}`,
    };
  }

  protected buildIndexes(rows: TestIndexed[]): void {
    this.byId.clear();
    for (const row of rows) {
      this.byId.set(row.instance.id, row);
    }
  }

  // Expose for testing
  getById(id: string): TestInstance | undefined {
    return this.byId.get(id)?.instance;
  }

  getLocalCount(): number {
    return this.localRows.length;
  }

  getAdoptedCount(): number {
    let count = 0;
    for (const rows of this.adopted.values()) {
      count += rows.length;
    }
    return count;
  }

  // Public method to trigger bump for testing
  triggerBump(kind: 'add' | 'remove' | 'update' | 'reset'): void {
    this.bump(kind);
  }

  // Access emitter for testing
  getVersion(): number {
    return this.version;
  }
}

describe('IndexedRegistry', () => {
  describe('construction and initialization', () => {
    it('should create empty registry', async () => {
      const registry = new TestIndexedRegistry([]);
      await registry.ready;

      expect(registry.hasAny()).toBe(false);
      expect(registry.getLocalCount()).toBe(0);
    });

    it('should initialize with records', async () => {
      const records: TestRecord[] = [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ];

      const registry = new TestIndexedRegistry(records);
      await registry.ready;

      expect(registry.hasAny()).toBe(true);
      expect(registry.getLocalCount()).toBe(2);
    });

    it('should build custom indexes', async () => {
      const records: TestRecord[] = [{ id: 'test-1', name: 'Test One' }];

      const registry = new TestIndexedRegistry(records);
      await registry.ready;

      expect(registry.getById('test-1')).toBeDefined();
      expect(registry.getById('test-1')?.name).toBe('Test One');
    });
  });

  describe('common indexes', () => {
    it('should index by qualifiedId', async () => {
      const records: TestRecord[] = [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ];

      const registry = new TestIndexedRegistry(records);
      await registry.ready;

      const all = registry.listAllIndexed();
      expect(all.length).toBe(2);

      const alpha = all.find((r) => r.instance.name === 'Alpha');
      expect(alpha?.qualifiedId).toBe('root:a');
    });

    it('should index by name', async () => {
      const records: TestRecord[] = [
        { id: 'a', name: 'Shared' },
        { id: 'b', name: 'Shared' },
        { id: 'c', name: 'Unique' },
      ];

      const registry = new TestIndexedRegistry(records);
      await registry.ready;

      expect(registry.findAllByName('Shared')).toHaveLength(2);
      expect(registry.findAllByName('Unique')).toHaveLength(1);
      expect(registry.findAllByName('Missing')).toHaveLength(0);
    });

    it('should index by owner', async () => {
      const ownerRef: EntryOwnerRef = {
        lineage: [{ type: 'test', id: 'owner-1', name: 'Owner 1' }],
        ownerKey: 'test:owner-1',
      };
      const records: TestRecord[] = [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ];

      const registry = new TestIndexedRegistry(records, ownerRef);
      await registry.ready;

      const owned = registry.listByOwner('test:owner-1');
      expect(owned).toHaveLength(2);
    });

    it('should support findByName for first match', async () => {
      const records: TestRecord[] = [
        { id: 'a', name: 'First' },
        { id: 'b', name: 'First' },
      ];

      const registry = new TestIndexedRegistry(records);
      await registry.ready;

      const result = registry.findByName('First');
      expect(result).toBeDefined();
    });

    it('should support findByQualifiedId', async () => {
      const records: TestRecord[] = [{ id: 'test-entry', name: 'Test Entry' }];

      const registry = new TestIndexedRegistry(records);
      await registry.ready;

      const result = registry.findByQualifiedId('root:test-entry');
      expect(result).toBeDefined();
      expect(result?.name).toBe('Test Entry');
    });
  });

  describe('adoption', () => {
    it('should adopt entries from child registry', async () => {
      const parent = new TestIndexedRegistry([{ id: 'p1', name: 'Parent' }]);
      await parent.ready;

      const childOwner: EntryOwnerRef = {
        lineage: [{ type: 'child', id: 'child-1', name: 'Child 1' }],
        ownerKey: 'child:child-1',
      };
      const child = new TestIndexedRegistry([{ id: 'c1', name: 'Child Entry' }], childOwner);
      await child.ready;

      parent.adoptFromChild(child, childOwner);

      expect(parent.getAdoptedCount()).toBe(1);
      expect(parent.listAllIndexed()).toHaveLength(2);
    });

    it('should update indexes after adoption', async () => {
      const parent = new TestIndexedRegistry([]);
      await parent.ready;

      const childOwner: EntryOwnerRef = {
        lineage: [{ type: 'child', id: 'child-1', name: 'Child' }],
        ownerKey: 'child:child-1',
      };
      const child = new TestIndexedRegistry([{ id: 'unique-id', name: 'Adopted Entry' }], childOwner);
      await child.ready;

      parent.adoptFromChild(child, childOwner);

      expect(parent.getById('unique-id')).toBeDefined();
      expect(parent.findByName('Adopted Entry')).toBeDefined();
    });

    it('should not duplicate children on re-adoption', async () => {
      const parent = new TestIndexedRegistry([]);
      await parent.ready;

      const childOwner: EntryOwnerRef = {
        lineage: [{ type: 'child', id: 'child-1', name: 'Child' }],
        ownerKey: 'child:child-1',
      };
      const child = new TestIndexedRegistry([{ id: 'c1', name: 'Child Entry' }], childOwner);
      await child.ready;

      parent.adoptFromChild(child, childOwner);
      parent.adoptFromChild(child, childOwner);

      // Same child's entries get replaced, not duplicated
      expect(parent.getAdoptedCount()).toBe(1);
    });

    it('should remove child registry', async () => {
      const parent = new TestIndexedRegistry([]);
      await parent.ready;

      const childOwner: EntryOwnerRef = {
        lineage: [{ type: 'child', id: 'child-1', name: 'Child' }],
        ownerKey: 'child:child-1',
      };
      const child = new TestIndexedRegistry([{ id: 'c1', name: 'Child Entry' }], childOwner);
      await child.ready;

      parent.adoptFromChild(child, childOwner);
      expect(parent.getAdoptedCount()).toBe(1);

      parent.removeChild(child);
      expect(parent.getAdoptedCount()).toBe(0);
    });
  });

  describe('change events', () => {
    it('should emit change events on bump', async () => {
      const registry = new TestIndexedRegistry([{ id: 'a', name: 'Alpha' }]);
      await registry.ready;

      const events: ChangeEvent<TestIndexed>[] = [];
      registry.subscribe({}, (event) => events.push(event));

      registry.triggerBump('add');

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('add');
      expect(events[0].snapshot).toHaveLength(1);
    });

    it('should increment version on bump', async () => {
      const registry = new TestIndexedRegistry([]);
      await registry.ready;

      let v1 = 0,
        v2 = 0;

      registry.subscribe({}, (event) => {
        v2 = event.version;
      });

      registry.triggerBump('update');
      v1 = v2;

      registry.triggerBump('update');

      expect(v2).toBeGreaterThan(v1);
    });

    it('should allow unsubscribing', async () => {
      const registry = new TestIndexedRegistry([]);
      await registry.ready;

      const events: any[] = [];
      const unsubscribe = registry.subscribe({}, (event) => events.push(event));

      registry.triggerBump('add');
      expect(events).toHaveLength(1);

      unsubscribe();

      registry.triggerBump('add');
      expect(events).toHaveLength(1); // No new events
    });

    it('should emit immediately with immediate option', async () => {
      const registry = new TestIndexedRegistry([{ id: 'a', name: 'Alpha' }]);
      await registry.ready;

      const events: ChangeEvent<TestIndexed>[] = [];
      registry.subscribe({ immediate: true }, (event) => events.push(event));

      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('reset');
    });

    it('should filter events with filter option', async () => {
      const registry = new TestIndexedRegistry([
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ]);
      await registry.ready;

      const events: ChangeEvent<TestIndexed>[] = [];
      registry.subscribe({ filter: (instance) => instance.name === 'Alpha' }, (event) => events.push(event));

      registry.triggerBump('update');

      expect(events).toHaveLength(1);
      expect(events[0].snapshot).toHaveLength(1);
      expect(events[0].snapshot[0].instance.name).toBe('Alpha');
    });
  });

  describe('dispose', () => {
    it('should clean up subscriptions on dispose', async () => {
      const parent = new TestIndexedRegistry([]);
      await parent.ready;

      const childOwner: EntryOwnerRef = {
        lineage: [{ type: 'child', id: 'child-1', name: 'Child' }],
        ownerKey: 'child:child-1',
      };
      const child = new TestIndexedRegistry([{ id: 'c1', name: 'Child' }], childOwner);
      await child.ready;

      parent.adoptFromChild(child, childOwner);
      expect(parent.getAdoptedCount()).toBe(1);

      parent.dispose();

      // After dispose, adopted entries and subscriptions are cleared
      expect(parent.getAdoptedCount()).toBe(0);
    });
  });

  describe('listAllIndexed', () => {
    it('should return all local and adopted entries', async () => {
      const parent = new TestIndexedRegistry([{ id: 'p1', name: 'Parent' }]);
      await parent.ready;

      const childOwner: EntryOwnerRef = {
        lineage: [{ type: 'child', id: 'child-1', name: 'Child' }],
        ownerKey: 'child:child-1',
      };
      const child = new TestIndexedRegistry([{ id: 'c1', name: 'Child' }], childOwner);
      await child.ready;

      parent.adoptFromChild(child, childOwner);

      const all = parent.listAllIndexed();
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.instance.id).sort()).toEqual(['c1', 'p1']);
    });
  });

  describe('listAllInstances', () => {
    it('should return all instances', async () => {
      const registry = new TestIndexedRegistry([
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
      ]);
      await registry.ready;

      const instances = registry.listAllInstances();
      expect(instances).toHaveLength(2);
      expect(instances.map((i) => i.name).sort()).toEqual(['Alpha', 'Beta']);
    });
  });
});
