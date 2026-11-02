import { type NamespacedStorage } from '@frontmcp/utils';

import {
  type JobExecutionState,
  type JobRunRecord,
  type JobStateStore,
  type WorkflowRunRecord,
} from './job-state.interface';

type RunRecord = JobRunRecord | WorkflowRunRecord;

/**
 * A JobStateStore on a `@frontmcp/utils` storage, such as the SQLite storage several processes on one
 * machine share. Each run is one JSON value under `run:<runId>`, and a cancel request is its own key,
 * `cancel:<runId>`, so no write of the run record can drop it. The store owns the storage and
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

  async updateRun(runId: string, updates: Partial<RunRecord>): Promise<void> {
    const existing = await this.getRun(runId);
    if (!existing) return;
    const { runId: _ignoreRunId, ...safeUpdates } = updates;
    await this.write({ ...existing, ...safeUpdates, revision: (existing.revision ?? 0) + 1, updatedAt: Date.now() });
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    const raw = await this.storage.get(runKey(runId));
    return raw ? (JSON.parse(raw) as RunRecord) : null;
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
      await this.storage.mdelete(stale.flatMap((run) => [runKey(run.runId), cancelKey(run.runId)]));
    }
    return stale.length;
  }

  async requestCancel(runId: string): Promise<void> {
    await this.storage.set(cancelKey(runId), '1', { ttlSeconds: this.ttlSeconds });
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    return this.storage.exists(cancelKey(runId));
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
    return values.filter((raw): raw is string => raw !== null).map((raw) => JSON.parse(raw) as RunRecord);
  }
}

function runKey(runId: string): string {
  return `run:${runId}`;
}

function cancelKey(runId: string): string {
  return `cancel:${runId}`;
}
