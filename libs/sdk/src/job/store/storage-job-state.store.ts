import { randomUUID, type NamespacedStorage } from '@frontmcp/utils';

import {
  FINISHED_JOB_STATES,
  type JobExecutionState,
  type JobRunRecord,
  type JobStateStore,
  type WorkflowRunRecord,
} from './job-state.interface';

type RunRecord = JobRunRecord | WorkflowRunRecord;

/** How many times a conditional write of a run is read again after another write landed first. */
const MAX_SWAPS = 20;

/** A field only the stored copy of a new run carries, so its creator can tell its own write from another's. */
const CREATE_CLAIM_FIELD = 'createClaim';

/**
 * A JobStateStore on a `@frontmcp/utils` storage, such as the SQLite storage several processes on one
 * machine share. Each run is one JSON value under `run:<runId>`, and a cancel request is its own key,
 * `cancel:<runId>`, so no write of the run record can drop it; a runner's heartbeat is `runner:<id>`. The store owns the storage and
 * disconnects it on dispose.
 */
export class StorageJobStateStore implements JobStateStore {
  constructor(
    private readonly storage: NamespacedStorage,
    private readonly ttlSeconds = 86400,
  ) {}

  async createRun(record: RunRecord): Promise<void> {
    await this.write({ ...record, revision: 1, updatedAt: Date.now() });
  }

  async createRunIfAbsent(record: RunRecord): Promise<boolean> {
    const stored = JSON.stringify({
      ...record,
      revision: 1,
      updatedAt: Date.now(),
      [CREATE_CLAIM_FIELD]: randomUUID(),
    });
    await this.storage.set(runKey(record.runId), stored, { ttlSeconds: this.ttlSeconds, ifNotExists: true });
    return (await this.storage.get(runKey(record.runId))) === stored;
  }

  async updateRun(runId: string, updates: Partial<RunRecord>): Promise<void> {
    const existing = await this.getRun(runId);
    if (!existing) return;
    await this.write(updatedRun(existing, updates));
  }

  async updateUnfinishedRun(runId: string, updates: Partial<RunRecord>): Promise<boolean> {
    for (let swaps = 0; swaps < MAX_SWAPS; swaps++) {
      const raw = await this.storage.get(runKey(runId));
      if (!raw) return false;
      const existing = parseRun(raw);
      if (FINISHED_JOB_STATES.has(existing.state)) return false;
      const next = JSON.stringify(updatedRun(existing, updates));
      if (!(await this.storage.setIfEquals(runKey(runId), raw, next))) continue;
      await this.storage.expireIfEquals(runKey(runId), next, this.ttlSeconds);
      return true;
    }
    throw new Error(`run ${runId} changed under each of ${MAX_SWAPS} writes`);
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const raw = await this.storage.get(runKey(runId));
    return raw ? parseRun(raw) : null;
  }

  async listRuns(opts?: {
    jobId?: string;
    sessionId?: string;
    state?: JobExecutionState;
    limit?: number;
  }): Promise<RunRecord[]> {
    const runs = (await this.allRuns()).filter(
      (run) =>
        (!opts?.jobId || run.jobId === opts.jobId) &&
        (!opts?.sessionId || run.sessionId === opts.sessionId) &&
        (!opts?.state || run.state === opts.state),
    );
    runs.sort((a, b) => b.startedAt - a.startedAt);
    return opts?.limit !== undefined && opts.limit > 0 ? runs.slice(0, opts.limit) : runs;
  }

  async cleanup(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    const stale = (await this.allRuns()).filter((run) => run.startedAt < cutoff);
    if (stale.length > 0) {
      await this.storage.mdelete(
        stale.flatMap((run) => [runKey(run.runId), cancelKey(run.runId), claimKey(run.runId)]),
      );
    }
    return stale.length;
  }

  async requestCancel(runId: string): Promise<void> {
    await this.storage.set(cancelKey(runId), '1', { ttlSeconds: this.ttlSeconds });
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    return this.storage.exists(cancelKey(runId));
  }

  async touchRunner(runnerId: string, ttlSeconds: number): Promise<void> {
    await this.storage.set(runnerKey(runnerId), '1', { ttlSeconds });
  }

  async isRunnerAlive(runnerId: string): Promise<boolean> {
    return this.storage.exists(runnerKey(runnerId));
  }

  async claimRun(runId: string): Promise<boolean> {
    const claimed = (await this.storage.incr(claimKey(runId))) === 1;
    if (claimed) await this.storage.expire(claimKey(runId), this.ttlSeconds);
    return claimed;
  }

  async readLeases(key: string): Promise<string> {
    return (await this.storage.get(leaseKey(key))) ?? '';
  }

  /** From none, through an empty value every process writes the same, so only one swap from it succeeds. */
  async swapLeases(key: string, expected: string, next: string, ttlSeconds: number): Promise<boolean> {
    if (expected === '') await this.storage.set(leaseKey(key), '', { ttlSeconds, ifNotExists: true });
    if (!(await this.storage.setIfEquals(leaseKey(key), expected, next))) return false;
    await this.storage.expireIfEquals(leaseKey(key), next, ttlSeconds);
    return true;
  }

  async dispose(): Promise<void> {
    await this.storage.disconnect();
  }

  private async write(record: RunRecord): Promise<void> {
    await this.storage.set(runKey(record.runId), JSON.stringify(record), { ttlSeconds: this.ttlSeconds });
  }

  private async allRuns(): Promise<RunRecord[]> {
    const keys = await this.storage.keys('run:*');
    if (keys.length === 0) return [];
    const values = await this.storage.mget(keys);
    return values.filter((raw): raw is string => raw !== null).map(parseRun);
  }
}

/** `existing` with `updates` merged in (never its `runId`), at the next revision. */
function updatedRun(existing: RunRecord, updates: Partial<RunRecord>): RunRecord {
  const { runId: _ignoreRunId, ...safeUpdates } = updates;
  return { ...existing, ...safeUpdates, revision: (existing.revision ?? 0) + 1, updatedAt: Date.now() } as RunRecord;
}

function runKey(runId: string): string {
  return `run:${runId}`;
}

/** A stored run, without the claim its creation left on it. */
function parseRun(raw: string): RunRecord {
  const { [CREATE_CLAIM_FIELD]: _createClaim, ...run } = JSON.parse(raw) as RunRecord & { createClaim?: string };
  return run;
}

function cancelKey(runId: string): string {
  return `cancel:${runId}`;
}

function runnerKey(runnerId: string): string {
  return `runner:${runnerId}`;
}

function leaseKey(key: string): string {
  return `lease:${key}`;
}

function claimKey(runId: string): string {
  return `claim:${runId}`;
}
