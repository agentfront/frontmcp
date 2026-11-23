import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createResultHandleStore, ResultHandleStore } from '@frontmcp/plugin-result-handles';
import { createMemoryStorage, mkdtemp, rm, type StorageConfig } from '@frontmcp/utils';

import { CodeCallRunStore, type CodeCallRunCaller, type CodeCallRunInput } from '../runs/run-record.store';
import type { CodeCallJournalEntry } from '../runs/run-record.types';

function callerOf(session: string | undefined, subject?: string): CodeCallRunCaller {
  return {
    tryGetContext: () => (session ? { verifiedSessionId: session } : undefined),
    auth: { isAnonymous: subject === undefined, user: { sub: subject } },
  };
}

function entry(position: number): CodeCallJournalEntry {
  return {
    position,
    tool: 'users.get',
    argumentsHash: 'a'.repeat(64),
    outcome: 'success',
    durationMs: 3,
    resultBytes: 40,
  };
}

function runOf(journal: CodeCallJournalEntry[]): CodeCallRunInput {
  return {
    scriptHash: 'b'.repeat(64),
    status: 'ok',
    startedAt: '2026-11-23T10:00:00.000Z',
    endedAt: '2026-11-23T10:00:00.050Z',
    reviewDecision: null,
    resultBytes: 12,
    journal,
  };
}

const alice = callerOf('session-1', 'alice');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'codecall-run-store-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each<[string, () => StorageConfig]>([
  ['memory', () => ({ type: 'memory' })],
  ['sqlite', () => ({ type: 'sqlite', sqlite: { path: join(dir, 'runs.sqlite') } })],
])('CodeCallRunStore on %s storage', (_, storageConfig) => {
  let store: CodeCallRunStore;

  beforeAll(async () => {
    const handles = await createResultHandleStore({
      storage: storageConfig(),
      namespace: 'codecall-runs',
      ttlSeconds: 60,
    });
    store = new CodeCallRunStore(handles, { maxRecordBytes: 256 * 1024, resume: false });
  });

  afterAll(async () => {
    await store.onShutdown();
  });

  it('keeps a record under a new run id that only its owner reads', async () => {
    const run = runOf([entry(1), entry(2), entry(3)]);
    const runId = await store.keep(alice, run);

    expect(runId).toMatch(UUID);
    expect(await store.read(runId ?? '', alice)).toEqual({
      runId,
      owner: { session: 'session-1', caller: 'alice' },
      ...run,
    });
  });

  it.each([
    ['another session', callerOf('session-2', 'alice')],
    ['another caller in the same session', callerOf('session-1', 'mallory')],
    ['an anonymous caller in the same session', callerOf('session-1')],
  ])('reads nothing for %s', async (__, other) => {
    const runId = await store.keep(alice, runOf([entry(1)]));
    expect(await store.read(runId ?? '', other)).toBeUndefined();
  });

  it('keeps nothing for a caller with no session and no subject', async () => {
    expect(await store.keep(callerOf(undefined), runOf([entry(1)]))).toBeUndefined();
  });

  it('forgets a record after its TTL', async () => {
    const runId = await store.keep(alice, runOf([entry(1)]));
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

    expect(await store.read(runId ?? '', alice)).toBeUndefined();
  });
});

describe('CodeCallRunStore limits', () => {
  async function memoryStore(options: { maxRecordBytes: number; resume: boolean }) {
    const root = createMemoryStorage();
    await root.connect();
    return { root, store: new CodeCallRunStore(new ResultHandleStore(root.namespace('codecall-runs'), 60), options) };
  }

  it('keeps the first journal entries that fit in maxRecordBytes and counts the rest', async () => {
    const { store } = await memoryStore({ maxRecordBytes: 1024, resume: false });
    const journal = Array.from({ length: 20 }, (_, index) => entry(index + 1));
    const runId = await store.keep(alice, runOf(journal));

    const record = await store.read(runId ?? '', alice);
    const kept = record?.journal.length ?? 0;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(20);
    expect(record?.journal).toEqual(journal.slice(0, kept));
    expect(record?.omittedEntries).toBe(20 - kept);
    expect(new TextEncoder().encode(JSON.stringify(record)).byteLength).toBeLessThanOrEqual(1024);
  });

  it('keeps the record encrypted, under a key that is not its run id', async () => {
    const { root, store } = await memoryStore({ maxRecordBytes: 256 * 1024, resume: true });
    const runId = await store.keep(alice, runOf([entry(1)]));

    const keys = await root.keys('*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^codecall-runs:/);
    expect(keys[0]).not.toContain(runId);
    const stored = (await root.get(keys[0])) ?? '';
    expect(stored).not.toContain('users.get');
    expect(stored).not.toContain('alice');
    expect(store.keepsResults).toBe(true);
  });
});
