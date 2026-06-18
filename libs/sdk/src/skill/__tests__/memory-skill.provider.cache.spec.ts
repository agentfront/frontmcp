// Coverage for the cold-start optimizations on MemorySkillProvider:
//   1. Lazy reindex — registering N skills must NOT trigger N reindexes; the
//      index builds exactly once, on the first search.
//   2. Snapshot cache — when the vector DB supports snapshots and a cache is
//      attached, a cache HIT restores via loadSnapshot (no reindex); a MISS
//      reindexes and persists the snapshot.
// The DB is a faithful fake injected into the provider so the logic is tested
// independently of which `vectoriadb` version is installed in node_modules.

import { MemorySkillProvider } from '../providers/memory-skill.provider';
import type { SkillIndexCache } from '../skill-index-cache.interface';
import type { SkillContent } from '../../common/interfaces';

interface FakeDoc {
  id: string;
  text: string;
  metadata: { id: string; skillId: string; skill: SkillContent };
}

class FakeVectorDb {
  docs = new Map<string, FakeDoc>();
  reindexCount = 0;
  loadSnapshotCount = 0;
  private dirty = false;

  addDocuments(docs: FakeDoc[]): void {
    for (const d of docs) this.docs.set(d.id, d);
    this.dirty = true;
  }
  removeDocument(id: string): boolean {
    const had = this.docs.delete(id);
    if (had) this.dirty = true;
    return had;
  }
  hasDocument(id: string): boolean {
    return this.docs.has(id);
  }
  clear(): void {
    this.docs.clear();
    this.dirty = false;
  }
  reindex(): void {
    this.reindexCount++;
    this.dirty = false;
  }
  needsReindexing(): boolean {
    return this.dirty;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  search(query: string, _opts: any): Array<{ id: string; metadata: FakeDoc['metadata']; score: number; text: string }> {
    const q = query.toLowerCase();
    return Array.from(this.docs.values())
      .map((d) => ({ id: d.id, metadata: d.metadata, score: d.text.toLowerCase().includes(q) ? 1 : 0, text: d.text }))
      .filter((r) => r.score > 0);
  }
  toSnapshot(): unknown {
    return { docs: Array.from(this.docs.entries()) };
  }
  loadSnapshot(snap: unknown): void {
    this.loadSnapshotCount++;
    this.docs = new Map((snap as { docs: [string, FakeDoc][] }).docs);
    this.dirty = false;
  }
}

async function inject(provider: MemorySkillProvider, db: FakeVectorDb): Promise<void> {
  // Let the provider's own lazy vectoriadb load settle FIRST (otherwise its
  // async continuation would clobber our injected fake), then replace it.
  await (provider as unknown as { vectorDBReady: Promise<void> }).vectorDBReady.catch(() => undefined);
  (provider as unknown as { vectorDB: unknown }).vectorDB = db;
  (provider as unknown as { vectorDBReady: Promise<void> }).vectorDBReady = Promise.resolve();
}

function skill(id: string, text: string): SkillContent {
  return { id, name: id, description: text, instructions: text, tools: [] } as unknown as SkillContent;
}

describe('MemorySkillProvider — lazy reindex + snapshot cache', () => {
  it('registers many skills with ZERO reindexes until the first search', async () => {
    const provider = new MemorySkillProvider();
    const db = new FakeVectorDb();
    await inject(provider, db);

    for (let i = 0; i < 25; i++) {
      await provider.add(skill(`s${i}`, `skill number ${i} about topic ${i % 5}`));
    }
    expect(db.reindexCount).toBe(0); // lazy — no per-add reindex

    const results = await provider.search('topic', { topK: 50 });
    expect(db.reindexCount).toBe(1); // built exactly once
    expect(results.length).toBeGreaterThan(0);

    // A second search with no mutation does not rebuild.
    await provider.search('topic', { topK: 50 });
    expect(db.reindexCount).toBe(1);
  });

  it('cache MISS reindexes and persists a snapshot', async () => {
    const store = new Map<string, unknown>();
    const cache: SkillIndexCache = {
      get: async (k) => store.get(k),
      set: async (k, v) => void store.set(k, v),
    };
    const provider = new MemorySkillProvider({ indexCache: cache });
    const db = new FakeVectorDb();
    await inject(provider, db);

    await provider.add(skill('a', 'authentication and login'));
    await provider.add(skill('b', 'billing and payment'));

    await provider.search('login', {});
    expect(db.reindexCount).toBe(1);
    expect(db.loadSnapshotCount).toBe(0);
    expect(store.size).toBe(1); // snapshot persisted
  });

  it('cache HIT restores via loadSnapshot WITHOUT reindexing', async () => {
    const store = new Map<string, unknown>();
    const cache: SkillIndexCache = {
      get: async (k) => store.get(k),
      set: async (k, v) => void store.set(k, v),
    };

    // First provider builds + populates the cache.
    const p1 = new MemorySkillProvider({ indexCache: cache });
    const db1 = new FakeVectorDb();
    await inject(p1, db1);
    await p1.add(skill('a', 'authentication and login'));
    await p1.add(skill('b', 'billing and payment'));
    await p1.warm();
    expect(store.size).toBe(1);

    // Second provider with the SAME skills should hit the cache.
    const p2 = new MemorySkillProvider({ indexCache: cache });
    const db2 = new FakeVectorDb();
    await inject(p2, db2);
    await p2.add(skill('a', 'authentication and login'));
    await p2.add(skill('b', 'billing and payment'));
    await p2.warm();

    expect(db2.loadSnapshotCount).toBe(1); // restored from cache
    expect(db2.reindexCount).toBe(0); // NOT rebuilt
  });

  it('different skill sets produce different cache keys (no stale restore)', async () => {
    const store = new Map<string, unknown>();
    const cache: SkillIndexCache = {
      get: async (k) => store.get(k),
      set: async (k, v) => void store.set(k, v),
    };
    const p1 = new MemorySkillProvider({ indexCache: cache });
    await inject(p1, new FakeVectorDb());
    await p1.add(skill('a', 'alpha'));
    await p1.warm();

    const p2 = new MemorySkillProvider({ indexCache: cache });
    const db2 = new FakeVectorDb();
    await inject(p2, db2);
    await p2.add(skill('a', 'alpha'));
    await p2.add(skill('c', 'gamma')); // different set → different key
    await p2.warm();

    expect(db2.loadSnapshotCount).toBe(0); // miss → rebuilt
    expect(db2.reindexCount).toBe(1);
    expect(store.size).toBe(2); // two distinct snapshots
  });

  it('a throwing cache degrades to a local rebuild (never blocks search)', async () => {
    const cache: SkillIndexCache = {
      get: async () => {
        throw new Error('KV down');
      },
      set: async () => {
        throw new Error('KV down');
      },
    };
    const provider = new MemorySkillProvider({ indexCache: cache });
    const db = new FakeVectorDb();
    await inject(provider, db);
    await provider.add(skill('a', 'resilient skill'));

    const results = await provider.search('resilient', {});
    expect(db.reindexCount).toBe(1);
    expect(results.length).toBe(1);
  });
});
