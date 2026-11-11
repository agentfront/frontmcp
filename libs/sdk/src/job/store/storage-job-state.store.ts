import { randomUUID, type NamespacedStorage } from '@frontmcp/utils';

import {
  type JobExecutionState,
  type JobRunRecord,
  type JobStateStore,
  type WorkflowRunRecord,
} from './job-state.interface';

type RunRecord = JobRunRecord | WorkflowRunRecord;

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
    const { runId: _ignoreRunId, ...safeUpdates } = updates;
    await this.write({ ...existing, ...safeUpdates, revision: (existing.revision ?? 0) + 1, updatedAt: Date.now() });
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

function claimKey(runId: string): string {
  return `claim:${runId}`;
}
