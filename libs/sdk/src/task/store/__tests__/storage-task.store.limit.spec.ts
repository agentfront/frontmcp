/** Memory, and the real RedisStorageAdapter over an ioredis stand-in whose commands yield so concurrent calls interleave. */
import {
  createMemoryStorage,
  createRootStorage,
  RedisStorageAdapter,
  type NamespacedStorage,
  type StorageAdapter,
} from '@frontmcp/utils';

import type { TaskRecord } from '../../task.types';
import { StorageTaskStore } from '../storage-task.store';

const COMPARE_AND_DELETE_PREFIX = "if redis.call('GET', KEYS[1]) == ARGV[1]";
const DEAD_WORKER_PID = 999_999;

/** The ioredis commands RedisStorageAdapter sends, kept in a Map with millisecond expiry. */
class FakeRedisClient {
  private readonly entries = new Map<string, { value: string; expiresAt?: number }>();
  failNextCompareAndDelete = false;

  async ping(): Promise<string> {
    return 'PONG';
  }

  async get(key: string): Promise<string | null> {
    await Promise.resolve();
    return this.read(key);
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    await Promise.resolve();
    return keys.map((key) => this.read(key));
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    await Promise.resolve();
    if (args.includes('NX') && this.read(key) !== null) return null;
    const ttlIndex = args.indexOf('EX');
    const ttlSeconds = ttlIndex >= 0 ? Number(args[ttlIndex + 1]) : undefined;
    this.entries.set(key, { value, expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    await Promise.resolve();
    return keys.filter((key) => this.entries.delete(key)).length;
  }

  async exists(key: string): Promise<number> {
    return this.read(key) === null ? 0 : 1;
  }

  async eval(script: string, _keyCount: number, key: string, expected: string): Promise<number> {
    await Promise.resolve();
    if (!script.startsWith(COMPARE_AND_DELETE_PREFIX)) throw new Error('unexpected script');
    if (this.failNextCompareAndDelete) {
      this.failNextCompareAndDelete = false;
      throw new Error('connection reset');
    }
    if (this.read(key) !== expected) return 0;
    this.entries.delete(key);
    return 1;
  }

  async publish(): Promise<number> {
    return 0;
  }

  async scan(_cursor: string, _match: 'MATCH', pattern: string): Promise<[string, string[]]> {
    await Promise.resolve();
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    const keys = [...this.entries.keys()].filter((key) => key.startsWith(prefix) && this.read(key) !== null);
    return ['0', keys];
  }

  private read(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }
}

interface Backend {
  storage: NamespacedStorage;
  redis?: FakeRedisClient;
}

const backends: Array<[string, () => Promise<Backend>]> = [
  [
    'memory',
    async () => {
      const storage = createMemoryStorage({ prefix: 'mcp:task:' });
      await storage.connect();
      return { storage };
    },
  ],
  [
    'Redis-shaped',
    async () => {
      const redis = new FakeRedisClient();
      const adapter = new RedisStorageAdapter({ client: redis as never });
      await adapter.connect();
      return { storage: createRootStorage(adapter as StorageAdapter), redis };
    },
  ],
];

let taskSequence = 0;

function newTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  taskSequence += 1;
  return {
    taskId: `task-${taskSequence}`,
    sessionId: 'owner-A',
    status: 'working',
    createdAt: nowIso,
    lastUpdatedAt: nowIso,
    ttlMs: 60_000,
    expiresAt: now + 60_000,
    request: { method: 'tools/call', params: { name: 'export_report', arguments: {} } },
    ...overrides,
  };
}

describe.each(backends)('StorageTaskStore.createWithinLimit (%s)', (_name, openBackend) => {
  let backend: Backend;
  let store: StorageTaskStore;

  beforeEach(async () => {
    backend = await openBackend();
    store = new StorageTaskStore(backend.storage);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await store.destroy();
  });

  it('admits exactly the cap from a concurrent burst', async () => {
    const created = await Promise.all(Array.from({ length: 20 }, () => store.createWithinLimit(newTask(), 16)));

    expect(created.filter(Boolean)).toHaveLength(16);
    expect((await store.list('owner-A')).tasks).toHaveLength(16);
  });

  it('writes nothing for a refused task', async () => {
    await store.createWithinLimit(newTask(), 1);
    const refused = newTask();

    expect(await store.createWithinLimit(refused, 1)).toBe(false);
    expect(await store.get(refused.taskId, 'owner-A')).toBeNull();
  });

  it('counts each owner separately', async () => {
    await store.createWithinLimit(newTask(), 1);

    expect(await store.createWithinLimit(newTask({ sessionId: 'owner-B' }), 1)).toBe(true);
  });

  it('counts a task waiting for input', async () => {
    const parked = newTask();
    await store.createWithinLimit(parked, 1);
    await store.update(parked.taskId, 'owner-A', { status: 'input_required' });

    expect(await store.createWithinLimit(newTask(), 1)).toBe(false);
  });

  it.each(['completed', 'failed', 'cancelled'] as const)('frees the slot when a task is %s', async (status) => {
    const finished = newTask();
    await store.createWithinLimit(finished, 1);
    await store.update(finished.taskId, 'owner-A', { status });

    expect(await store.createWithinLimit(newTask(), 1)).toBe(true);
  });

  it('frees the slot once, when a cancel and the runner finish the task at the same time', async () => {
    const raced = newTask();
    await store.createWithinLimit(raced, 2);
    const other = newTask();
    await store.createWithinLimit(other, 2);
    await Promise.all([
      store.update(raced.taskId, 'owner-A', { status: 'cancelled' }),
      store.update(raced.taskId, 'owner-A', { status: 'completed' }),
    ]);

    expect(await store.createWithinLimit(newTask(), 2)).toBe(true);
    expect(await store.createWithinLimit(newTask(), 2)).toBe(false);
  });

  it('frees the slot when a task is deleted', async () => {
    const deleted = newTask();
    await store.createWithinLimit(deleted, 1);
    await store.delete(deleted.taskId, 'owner-A');

    expect(await store.createWithinLimit(newTask(), 1)).toBe(true);
  });

  it('frees the slot when a task expires', async () => {
    const realNow = Date.now();
    await store.createWithinLimit(newTask({ ttlMs: 1_000, expiresAt: realNow + 1_000 }), 1);
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 2_500);

    expect(await store.createWithinLimit(newTask({ expiresAt: realNow + 60_000 }), 1)).toBe(true);
  });

  it('reclaims the slot of a task whose CLI worker died, and marks the task failed', async () => {
    const crashed = newTask();
    await store.createWithinLimit(crashed, 1);
    await store.update(crashed.taskId, 'owner-A', { executor: { host: 'cli', pid: DEAD_WORKER_PID } });

    expect(await store.createWithinLimit(newTask(), 1)).toBe(true);
    expect((await store.get(crashed.taskId, 'owner-A'))?.status).toBe('failed');
  });

  it('keeps the slot of a task whose CLI worker is alive', async () => {
    const running = newTask();
    await store.createWithinLimit(running, 1);
    await store.update(running.taskId, 'owner-A', { executor: { host: 'cli', pid: process.pid } });

    expect(await store.createWithinLimit(newTask(), 1)).toBe(false);
  });

  it('keeps the slot of a task that runs in process', async () => {
    const running = newTask();
    await store.createWithinLimit(running, 1);
    await store.update(running.taskId, 'owner-A', { executor: { host: 'in-process' } });

    expect(await store.createWithinLimit(newTask(), 1)).toBe(false);
  });

  it('never sends the slot to clients', async () => {
    const task = newTask();
    await store.createWithinLimit(task, 1);

    expect((await store.get(task.taskId, 'owner-A'))?.concurrencySlot).toBe(0);
  });
});

describe('StorageTaskStore.createWithinLimit when a release fails (Redis-shaped)', () => {
  it('reclaims the slot of the finished task when its owner next reaches the cap', async () => {
    const redis = new FakeRedisClient();
    const adapter = new RedisStorageAdapter({ client: redis as never });
    await adapter.connect();
    const store = new StorageTaskStore(createRootStorage(adapter as StorageAdapter));
    const finished = newTask();
    await store.createWithinLimit(finished, 1);

    redis.failNextCompareAndDelete = true;
    await store.update(finished.taskId, 'owner-A', { status: 'completed' });

    expect(await store.createWithinLimit(newTask(), 1)).toBe(true);
  });
});
