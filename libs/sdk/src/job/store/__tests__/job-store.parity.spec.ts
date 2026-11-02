/**
 * The job stores keep the same contract on every backend: what the memory store does, the SQLite store
 * does too, and the SQLite store keeps it for the next process that opens the file.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { JobKind, type JobDynamicRecord } from '../../../common/records/job.record';
import { WorkflowKind, type WorkflowDynamicRecord } from '../../../common/records/workflow.record';
import { createJobDefinitionStore } from '../job-definition-store.factory';
import { type JobDefinitionStore } from '../job-definition.interface';
import { createJobStateStore } from '../job-state-store.factory';
import { type JobRunRecord, type JobStateStore } from '../job-state.interface';
import { RedisJobStateStore, type RedisStateStoreLike } from '../redis-job-state.store';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-job-store-'));
  dbPath = path.join(dir, 'jobs.sqlite');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(runId: string, overrides: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    runId,
    jobId: 'report',
    jobName: 'report',
    sessionId: 'session-1',
    state: 'pending',
    input: { day: 'monday' },
    startedAt: 1_000,
    attempt: 1,
    maxAttempts: 1,
    logs: [],
    background: true,
    ...overrides,
  };
}

/** The Redis commands the Redis job state store sends, kept in Maps. Its key patterns end in `*`. */
function fakeRedis(): RedisStateStoreLike {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  function setOf(key: string): Set<string> {
    let set = sets.get(key);
    if (!set) {
      set = new Set();
      sets.set(key, set);
    }
    return set;
  }
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => values.set(key, value),
    del: async (key) => (values.delete(String(key)) ? 1 : 0),
    sadd: async (key, ...members) => {
      members.forEach((member) => setOf(key).add(member));
      return members.length;
    },
    srem: async (key, ...members) => members.filter((member) => setOf(key).delete(member)).length,
    smembers: async (key) => [...setOf(key)],
    keys: async (pattern) => [...values.keys()].filter((key) => key.startsWith(pattern.replace(/\*$/, ''))),
  };
}

const stateBackends: Array<[string, () => Promise<JobStateStore>]> = [
  ['memory', async () => (await createJobStateStore({})).store],
  ['sqlite', async () => (await createJobStateStore({ sqlite: { path: dbPath } })).store],
  ['redis', async () => new RedisJobStateStore(fakeRedis(), undefined)],
];

describe.each(stateBackends)('%s job state store', (_backend, open) => {
  let store: JobStateStore;

  beforeEach(async () => {
    store = await open();
  });

  afterEach(async () => {
    await store.dispose();
  });

  it('reads back a run it created, at revision 1', async () => {
    await store.createRun(run('r1'));

    expect(await store.getRun('r1')).toEqual(
      expect.objectContaining({ runId: 'r1', state: 'pending', input: { day: 'monday' }, revision: 1 }),
    );
  });

  it('answers null for an unknown run', async () => {
    expect(await store.getRun('missing')).toBeNull();
  });

  it('merges an update, bumps the revision and stamps updatedAt', async () => {
    await store.createRun(run('r1'));
    const before = await store.getRun('r1');

    await store.updateRun('r1', { state: 'running', progress: { progress: 2, total: 5, message: 'two' } });

    const after = await store.getRun('r1');
    expect(after).toEqual(
      expect.objectContaining({ state: 'running', progress: { progress: 2, total: 5, message: 'two' }, revision: 2 }),
    );
    expect(after?.updatedAt).toBeGreaterThanOrEqual(before?.updatedAt ?? 0);
  });

  it('keeps the run id when an update names another', async () => {
    await store.createRun(run('r1'));

    await store.updateRun('r1', { runId: 'r2', state: 'running' });

    expect((await store.getRun('r1'))?.runId).toBe('r1');
    expect(await store.getRun('r2')).toBeNull();
  });

  it('ignores an update of an unknown run', async () => {
    await store.updateRun('missing', { state: 'running' });

    expect(await store.getRun('missing')).toBeNull();
  });

  it('lists runs newest first, filtered by job, session and state, up to a limit', async () => {
    await store.createRun(run('old', { startedAt: 1_000 }));
    await store.createRun(run('new', { startedAt: 3_000, state: 'running' }));
    await store.createRun(run('other', { startedAt: 2_000, jobId: 'export', sessionId: 'session-2' }));

    expect((await store.listRuns()).map((r) => r.runId)).toEqual(['new', 'other', 'old']);
    expect((await store.listRuns({ jobId: 'report' })).map((r) => r.runId)).toEqual(['new', 'old']);
    expect((await store.listRuns({ sessionId: 'session-2' })).map((r) => r.runId)).toEqual(['other']);
    expect((await store.listRuns({ state: 'running' })).map((r) => r.runId)).toEqual(['new']);
    expect((await store.listRuns({ limit: 1 })).map((r) => r.runId)).toEqual(['new']);
  });

  it('removes the runs started before a cutoff', async () => {
    await store.createRun(run('old', { startedAt: Date.now() - 60_000 }));
    await store.createRun(run('fresh', { startedAt: Date.now() }));

    expect(await store.cleanup(30_000)).toBe(1);
    expect((await store.listRuns()).map((r) => r.runId)).toEqual(['fresh']);
  });

  it('records a cancel request any process can read', async () => {
    await store.createRun(run('r1'));

    expect(await store.isCancelRequested('r1')).toBe(false);
    await store.requestCancel('r1');
    expect(await store.isCancelRequested('r1')).toBe(true);
    expect(await store.isCancelRequested('r2')).toBe(false);
  });
});

describe('sqlite job state store across processes', () => {
  it('keeps runs and cancel requests for the next store that opens the file', async () => {
    const first = (await createJobStateStore({ sqlite: { path: dbPath } })).store;
    await first.createRun(run('r1'));
    await first.updateRun('r1', { state: 'running' });
    await first.requestCancel('r1');
    await first.dispose();

    const second = (await createJobStateStore({ sqlite: { path: dbPath } })).store;
    expect(await second.getRun('r1')).toEqual(expect.objectContaining({ state: 'running', revision: 2 }));
    expect(await second.isCancelRequested('r1')).toBe(true);
    await second.dispose();
  });

  it('shares the file with other stores under its own key prefix', async () => {
    const reports = (await createJobStateStore({ sqlite: { path: dbPath }, keyPrefix: 'reports:' })).store;
    const exports = (await createJobStateStore({ sqlite: { path: dbPath }, keyPrefix: 'exports:' })).store;
    await reports.createRun(run('r1'));

    expect(await exports.getRun('r1')).toBeNull();
    expect(await exports.listRuns()).toEqual([]);
    await reports.dispose();
    await exports.dispose();
  });
});

function jobDefinition(id: string): JobDynamicRecord {
  return {
    kind: JobKind.DYNAMIC,
    provide: id,
    metadata: { name: id, inputSchema: {}, outputSchema: {} },
    script: 'return {}',
    registeredAt: 1_000,
  };
}

function workflowDefinition(id: string): WorkflowDynamicRecord {
  return {
    kind: WorkflowKind.DYNAMIC,
    provide: id,
    metadata: { name: id, steps: [{ id: 'one', jobName: 'report' }] },
    registeredAt: 1_000,
  };
}

const definitionBackends: Array<[string, () => Promise<JobDefinitionStore>]> = [
  ['memory', async () => (await createJobDefinitionStore({})).store],
  ['sqlite', async () => (await createJobDefinitionStore({ sqlite: { path: dbPath } })).store],
];

describe.each(definitionBackends)('%s job definition store', (_backend, open) => {
  let store: JobDefinitionStore;

  beforeEach(async () => {
    store = await open();
  });

  afterEach(async () => {
    await store.dispose();
  });

  it('saves, lists, reads and removes job definitions', async () => {
    await store.saveDefinition(jobDefinition('a'));
    await store.saveDefinition(jobDefinition('b'));

    expect((await store.listDefinitions()).map((d) => d.provide).sort()).toEqual(['a', 'b']);
    expect(await store.getDefinition('a')).toEqual(jobDefinition('a'));
    expect(await store.removeDefinition('a')).toBe(true);
    expect(await store.removeDefinition('a')).toBe(false);
    expect(await store.getDefinition('a')).toBeNull();
  });

  it('saves, lists, reads and removes workflow definitions apart from job definitions', async () => {
    await store.saveDefinition(jobDefinition('a'));
    await store.saveWorkflowDefinition(workflowDefinition('a'));

    expect(await store.listWorkflowDefinitions()).toEqual([workflowDefinition('a')]);
    expect(await store.getWorkflowDefinition('a')).toEqual(workflowDefinition('a'));
    expect(await store.removeWorkflowDefinition('a')).toBe(true);
    expect(await store.removeWorkflowDefinition('a')).toBe(false);
    expect(await store.getWorkflowDefinition('a')).toBeNull();
    expect(await store.getDefinition('a')).toEqual(jobDefinition('a'));
  });
});

describe('sqlite job definition store across processes', () => {
  it('keeps definitions for the next store that opens the file', async () => {
    const first = (await createJobDefinitionStore({ sqlite: { path: dbPath } })).store;
    await first.saveDefinition(jobDefinition('a'));
    await first.dispose();

    const second = (await createJobDefinitionStore({ sqlite: { path: dbPath } })).store;
    expect(await second.listDefinitions()).toEqual([jobDefinition('a')]);
    await second.dispose();
  });
});

describe('job store factories with SQLite', () => {
  it('reports the sqlite type', async () => {
    const state = await createJobStateStore({ sqlite: { path: dbPath } });
    const definitions = await createJobDefinitionStore({ sqlite: { path: dbPath } });

    expect(state.type).toBe('sqlite');
    expect(definitions.type).toBe('sqlite');
    await state.store.dispose();
    await definitions.store.dispose();
  });

  it('fails instead of falling back to memory when the sqlite options are invalid', async () => {
    await expect(createJobStateStore({ sqlite: { path: '' } })).rejects.toThrow(/sqlite\.path/);
    await expect(createJobDefinitionStore({ sqlite: { path: '' } })).rejects.toThrow(/sqlite\.path/);
  });
});
