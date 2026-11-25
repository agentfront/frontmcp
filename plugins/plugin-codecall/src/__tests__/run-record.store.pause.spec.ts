import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ResultHandleStore } from '@frontmcp/plugin-result-handles';
import { createStorage, mkdtemp, rm, sha256Hex, type StorageConfig } from '@frontmcp/utils';

import { CodeCallRunStore, type CodeCallRunCaller, type CodeCallRunInput } from '../runs/run-record.store';

function callerOf(session: string, subject?: string): CodeCallRunCaller {
  return {
    tryGetContext: () => ({ verifiedSessionId: session }),
    auth: { isAnonymous: subject === undefined, user: { sub: subject } },
  };
}

const SCRIPT = "return await callTool('orders.get', { id: 'o1' });";
const alice = callerOf('session-1', 'alice');

function pausedRun(overrides: { script?: string; expiresAt?: string } = {}): CodeCallRunInput {
  return {
    scriptHash: sha256Hex(SCRIPT),
    status: 'paused',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    reviewDecision: null,
    journal: [],
    pause: {
      id: 'pause-1',
      call: { position: 1, tool: 'orders.get', argumentsHash: 'a'.repeat(64) },
      answer: 'needs_approval',
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
      script: overrides.script ?? SCRIPT,
    },
  };
}

async function storeOn(storage: StorageConfig): Promise<CodeCallRunStore> {
  const records = (await createStorage(storage)).namespace('codecall-runs');
  return new CodeCallRunStore(new ResultHandleStore(records, 60), {
    maxRecordBytes: 256 * 1024,
    resume: true,
    claims: records.namespace('claims'),
  });
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'codecall-run-pause-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('paused runs in the run store', () => {
  let store: CodeCallRunStore;

  beforeEach(async () => {
    store = await storeOn({ type: 'memory' });
  });

  afterEach(async () => {
    await store.onShutdown();
  });

  it('reads a paused run for its owner only, while it waits, and only with the script its record names', async () => {
    const runId = (await store.keep(alice, pausedRun())) as string;
    const expired = (await store.keep(
      alice,
      pausedRun({ expiresAt: new Date(Date.now() - 1).toISOString() }),
    )) as string;
    const changed = (await store.keep(alice, pausedRun({ script: `${SCRIPT} ` }))) as string;

    expect(await store.readPaused(runId, alice)).toMatchObject({ runId, pause: { id: 'pause-1' } });
    expect(await store.readPaused(runId, callerOf('session-2', 'alice'))).toBeUndefined();
    expect(await store.readPaused(expired, alice)).toBeUndefined();
    expect(await store.readPaused(changed, alice)).toBeUndefined();
  });

  it('claims a pause once, for its owner', async () => {
    const runId = (await store.keep(alice, pausedRun())) as string;

    const claims = await Promise.all([1, 2, 3].map(() => store.claim(runId, alice, 'pause-1', 60)));

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await store.claim(runId, alice, 'pause-2', 60)).toBe(true);
    expect(await store.claim(runId, callerOf('session-2', 'alice'), 'pause-1', 60)).toBe(true);
  });

  it('keeps a paused run for its own TTL', async () => {
    const runId = (await store.keep(alice, pausedRun(), 1)) as string;
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + 1500);

    expect(await store.read(runId, alice)).toBeUndefined();
    jest.restoreAllMocks();
  });

  it('fits a run whole only when keep() would keep every journal entry, at the byte where it stops', async () => {
    const entry = {
      position: 1,
      tool: 'orders.get',
      argumentsHash: 'a'.repeat(64),
      outcome: 'success' as const,
      durationMs: 1,
    };
    const run = {
      ...pausedRun(),
      runId: '3f0c6f7e-5d1b-4f43-9a4d-2a7c1b6e8f10',
      journal: [entry, { ...entry, position: 2 }],
    };
    const metadata = { ...run, owner: { session: 'session-1', caller: 'alice' }, journal: [], omittedEntries: 2 };
    const wholeBytes = Buffer.byteLength(JSON.stringify(metadata)) + 2 * (Buffer.byteLength(JSON.stringify(entry)) + 1);
    const storeOf = (maxRecordBytes: number) =>
      new CodeCallRunStore({ newHandle: () => run.runId } as unknown as ResultHandleStore, {
        maxRecordBytes,
        resume: true,
      });

    expect(storeOf(wholeBytes).fitsWhole(alice, run)).toBe(true);
    expect(storeOf(wholeBytes - 1).fitsWhole(alice, run)).toBe(false);
  });

  it('says whether a run fits whole in runs.maxRecordBytes', () => {
    const small = new CodeCallRunStore({ newHandle: () => 'id' } as unknown as ResultHandleStore, {
      maxRecordBytes: 1024,
      resume: true,
    });

    expect(small.fitsWhole(alice, pausedRun())).toBe(true);
    expect(small.fitsWhole(alice, pausedRun({ script: SCRIPT.repeat(30) }))).toBe(false);
  });
});

describe('claims on storage two instances share', () => {
  it('lets only one instance claim a pause', async () => {
    const storage: StorageConfig = { type: 'sqlite', sqlite: { path: join(dir, 'claims.sqlite') } };
    const [first, second] = await Promise.all([storeOn(storage), storeOn(storage)]);
    const runId = (await first.keep(alice, pausedRun())) as string;

    const claims = await Promise.all([
      first.claim(runId, alice, 'pause-1', 60),
      second.claim(runId, alice, 'pause-1', 60),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    await Promise.all([first.onShutdown(), second.onShutdown()]);
  });
});
