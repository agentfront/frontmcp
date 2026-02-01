/**
 * Sync State Tests
 *
 * Tests for sync state management and persistence.
 */

import {
  createEmptySyncState,
  serializeSyncState,
  deserializeSyncState,
  SkillSyncState,
  SkillSyncEntry,
} from '../sync/sync-state.interface';
import { MemorySyncStateStore } from '../sync/memory-sync-state.store';

// Helper to create test sync entries
const createTestEntry = (overrides: Partial<SkillSyncEntry> = {}): SkillSyncEntry => ({
  skillId: 'test-skill',
  hash: 'abc123def456',
  lastSyncedAt: Date.now(),
  status: 'synced',
  ...overrides,
});

describe('sync-state', () => {
  describe('createEmptySyncState', () => {
    it('should create empty state with defaults', () => {
      const state = createEmptySyncState();

      expect(state.version).toBe(1);
      expect(state.lastFullSync).toBe(0);
      expect(state.entries).toBeInstanceOf(Map);
      expect(state.entries.size).toBe(0);
    });

    it('should create independent instances', () => {
      const state1 = createEmptySyncState();
      const state2 = createEmptySyncState();

      state1.entries.set('skill-1', createTestEntry({ skillId: 'skill-1' }));

      expect(state1.entries.size).toBe(1);
      expect(state2.entries.size).toBe(0);
    });
  });

  describe('serializeSyncState / deserializeSyncState', () => {
    it('should serialize and deserialize state correctly', () => {
      const original: SkillSyncState = {
        version: 1,
        lastFullSync: 1704067200000, // 2024-01-01
        entries: new Map([
          ['skill-1', createTestEntry({ skillId: 'skill-1', hash: 'hash1' })],
          ['skill-2', createTestEntry({ skillId: 'skill-2', hash: 'hash2' })],
        ]),
      };

      const serialized = serializeSyncState(original);
      const deserialized = deserializeSyncState(serialized);

      expect(deserialized.version).toBe(original.version);
      expect(deserialized.lastFullSync).toBe(original.lastFullSync);
      expect(deserialized.entries.size).toBe(2);
      expect(deserialized.entries.get('skill-1')?.hash).toBe('hash1');
      expect(deserialized.entries.get('skill-2')?.hash).toBe('hash2');
    });

    it('should serialize state as JSON-compatible', () => {
      const state: SkillSyncState = {
        version: 1,
        lastFullSync: Date.now(),
        entries: new Map([['skill-1', createTestEntry()]]),
      };

      const serialized = serializeSyncState(state);
      const jsonString = JSON.stringify(serialized);
      const parsed = JSON.parse(jsonString);

      expect(parsed.version).toBe(state.version);
      expect(parsed.entries).toBeInstanceOf(Array);
      expect(parsed.entries.length).toBe(1);
    });

    it('should handle empty state', () => {
      const empty = createEmptySyncState();

      const serialized = serializeSyncState(empty);
      const deserialized = deserializeSyncState(serialized);

      expect(deserialized.entries.size).toBe(0);
      expect(deserialized.version).toBe(1);
    });

    it('should preserve entry status and error fields', () => {
      const state: SkillSyncState = {
        version: 1,
        lastFullSync: Date.now(),
        entries: new Map([
          ['success', createTestEntry({ skillId: 'success', status: 'synced' })],
          ['pending', createTestEntry({ skillId: 'pending', status: 'pending' })],
          ['failed', createTestEntry({ skillId: 'failed', status: 'failed', error: 'Connection timeout' })],
        ]),
      };

      const serialized = serializeSyncState(state);
      const deserialized = deserializeSyncState(serialized);

      expect(deserialized.entries.get('success')?.status).toBe('synced');
      expect(deserialized.entries.get('pending')?.status).toBe('pending');
      expect(deserialized.entries.get('failed')?.status).toBe('failed');
      expect(deserialized.entries.get('failed')?.error).toBe('Connection timeout');
    });

    it('should preserve externalId field', () => {
      const state: SkillSyncState = {
        version: 1,
        lastFullSync: Date.now(),
        entries: new Map([['skill-1', createTestEntry({ skillId: 'skill-1', externalId: 'ext-uuid-123' })]]),
      };

      const serialized = serializeSyncState(state);
      const deserialized = deserializeSyncState(serialized);

      expect(deserialized.entries.get('skill-1')?.externalId).toBe('ext-uuid-123');
    });
  });

  describe('MemorySyncStateStore', () => {
    let store: MemorySyncStateStore;

    beforeEach(() => {
      store = new MemorySyncStateStore();
    });

    describe('load/save', () => {
      it('should return null when no state saved', async () => {
        const state = await store.load();

        expect(state).toBeNull();
      });

      it('should save and load state', async () => {
        const original: SkillSyncState = {
          version: 1,
          lastFullSync: Date.now(),
          entries: new Map([['skill-1', createTestEntry()]]),
        };

        await store.save(original);
        const loaded = await store.load();

        expect(loaded).not.toBeNull();
        expect(loaded?.version).toBe(original.version);
        expect(loaded?.entries.size).toBe(1);
      });

      it('should return deep copy to prevent mutations', async () => {
        const original: SkillSyncState = {
          version: 1,
          lastFullSync: Date.now(),
          entries: new Map([['skill-1', createTestEntry()]]),
        };

        await store.save(original);
        const loaded1 = await store.load();
        loaded1?.entries.set('skill-2', createTestEntry({ skillId: 'skill-2' }));
        const loaded2 = await store.load();

        expect(loaded1?.entries.size).toBe(2);
        expect(loaded2?.entries.size).toBe(1);
      });

      it('should overwrite previous state', async () => {
        const state1: SkillSyncState = {
          version: 1,
          lastFullSync: 1000,
          entries: new Map([['skill-1', createTestEntry()]]),
        };
        const state2: SkillSyncState = {
          version: 1,
          lastFullSync: 2000,
          entries: new Map([
            ['skill-2', createTestEntry({ skillId: 'skill-2' })],
            ['skill-3', createTestEntry({ skillId: 'skill-3' })],
          ]),
        };

        await store.save(state1);
        await store.save(state2);
        const loaded = await store.load();

        expect(loaded?.lastFullSync).toBe(2000);
        expect(loaded?.entries.size).toBe(2);
        expect(loaded?.entries.has('skill-1')).toBe(false);
        expect(loaded?.entries.has('skill-2')).toBe(true);
      });
    });

    describe('clear', () => {
      it('should clear stored state', async () => {
        await store.save({
          version: 1,
          lastFullSync: Date.now(),
          entries: new Map([['skill-1', createTestEntry()]]),
        });

        await store.clear();
        const loaded = await store.load();

        expect(loaded).toBeNull();
      });

      it('should handle clear when no state exists', async () => {
        await expect(store.clear()).resolves.toBeUndefined();

        const loaded = await store.load();
        expect(loaded).toBeNull();
      });
    });

    describe('helper methods', () => {
      it('hasState should return false initially', () => {
        expect(store.hasState()).toBe(false);
      });

      it('hasState should return true after save', async () => {
        await store.save(createEmptySyncState());

        expect(store.hasState()).toBe(true);
      });

      it('hasState should return false after clear', async () => {
        await store.save(createEmptySyncState());
        await store.clear();

        expect(store.hasState()).toBe(false);
      });

      it('getEntryCount should return 0 initially', () => {
        expect(store.getEntryCount()).toBe(0);
      });

      it('getEntryCount should return correct count after save', async () => {
        await store.save({
          version: 1,
          lastFullSync: Date.now(),
          entries: new Map([
            ['skill-1', createTestEntry({ skillId: 'skill-1' })],
            ['skill-2', createTestEntry({ skillId: 'skill-2' })],
            ['skill-3', createTestEntry({ skillId: 'skill-3' })],
          ]),
        });

        expect(store.getEntryCount()).toBe(3);
      });
    });
  });
});
