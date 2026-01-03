/**
 * Tests for SimpleRegistry.
 */

import 'reflect-metadata';
import { SimpleRegistry } from '../registry/simple.registry.js';
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
}

// Concrete implementation for testing
class TestSimpleRegistry extends SimpleRegistry<TestInstance, TestRecord, TestRecord[], undefined> {
  constructor(records: TestRecord[] = []) {
    super('TestSimple', undefined, records, true);
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
    // No dependencies
  }

  protected async initialize(): Promise<void> {
    for (const [token, rec] of this.defs) {
      const instance: TestInstance = { id: rec.id, name: rec.name };
      this.instances.set(token, instance);
    }
  }

  // Expose for testing
  getByToken(token: Token): TestInstance | undefined {
    return this.instances.get(token as Token<TestInstance>);
  }
}

describe('SimpleRegistry', () => {
  describe('construction', () => {
    it('should create empty registry', async () => {
      const registry = new TestSimpleRegistry([]);
      await registry.ready;

      expect(registry.hasAny()).toBe(false);
      expect(registry.count()).toBe(0);
      expect(registry.getAll()).toEqual([]);
    });

    it('should initialize with records', async () => {
      const records: TestRecord[] = [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
        { id: 'c', name: 'Gamma' },
      ];

      const registry = new TestSimpleRegistry(records);
      await registry.ready;

      expect(registry.hasAny()).toBe(true);
      expect(registry.count()).toBe(3);
    });
  });

  describe('getAll', () => {
    it('should return all instances as array', async () => {
      const records: TestRecord[] = [
        { id: '1', name: 'First' },
        { id: '2', name: 'Second' },
      ];

      const registry = new TestSimpleRegistry(records);
      await registry.ready;

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((i) => i.name).sort()).toEqual(['First', 'Second']);
    });

    it('should return empty array for empty registry', async () => {
      const registry = new TestSimpleRegistry([]);
      await registry.ready;

      expect(registry.getAll()).toEqual([]);
    });
  });

  describe('count', () => {
    it('should return 0 for empty registry', async () => {
      const registry = new TestSimpleRegistry([]);
      await registry.ready;

      expect(registry.count()).toBe(0);
    });

    it('should return correct count', async () => {
      const records: TestRecord[] = [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
        { id: '3', name: 'C' },
        { id: '4', name: 'D' },
        { id: '5', name: 'E' },
      ];

      const registry = new TestSimpleRegistry(records);
      await registry.ready;

      expect(registry.count()).toBe(5);
    });
  });

  describe('getAllInstances (inherited)', () => {
    it('should return readonly map', async () => {
      const records: TestRecord[] = [{ id: '1', name: 'Test' }];

      const registry = new TestSimpleRegistry(records);
      await registry.ready;

      const instances = registry.getAllInstances();
      expect(instances.size).toBe(1);
    });
  });

  describe('hasAny (inherited)', () => {
    it('should return false for empty registry', async () => {
      const registry = new TestSimpleRegistry([]);
      await registry.ready;

      expect(registry.hasAny()).toBe(false);
    });

    it('should return true when instances exist', async () => {
      const registry = new TestSimpleRegistry([{ id: '1', name: 'Test' }]);
      await registry.ready;

      expect(registry.hasAny()).toBe(true);
    });
  });
});
