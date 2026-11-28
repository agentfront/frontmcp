import {
  type JobExecutionState,
  type JobRunRecord,
  type JobStateStore,
  type WorkflowRunRecord,
} from './job-state.interface';

/**
 * In-memory implementation of JobStateStore.
 * Suitable for development and testing.
 */
export class MemoryJobStateStore implements JobStateStore {
  private readonly runs = new Map<string, JobRunRecord | WorkflowRunRecord>();
  private readonly cancelRequests = new Set<string>();
  private readonly runnerExpiries = new Map<string, number>();
  private readonly claims = new Set<string>();
  private readonly leases = new Map<string, { value: string; expiresAt: number }>();

  async createRun(record: JobRunRecord | WorkflowRunRecord): Promise<void> {
    this.runs.set(record.runId, { ...record, revision: 1, updatedAt: Date.now() });
  }

  async createRunIfAbsent(record: JobRunRecord | WorkflowRunRecord): Promise<boolean> {
    if (this.runs.has(record.runId)) return false;
    this.runs.set(record.runId, { ...record, revision: 1, updatedAt: Date.now() });
    return true;
  }

  async updateRun(runId: string, updates: Partial<JobRunRecord | WorkflowRunRecord>): Promise<void> {
    const existing = this.runs.get(runId);
    if (!existing) return;
    const { runId: _ignoreRunId, ...safeUpdates } = updates;
    const revision = (existing.revision ?? 0) + 1;
    this.runs.set(runId, { ...existing, ...safeUpdates, revision, updatedAt: Date.now() });
  }

  async getRun(runId: string): Promise<JobRunRecord | WorkflowRunRecord | null> {
    const record = this.runs.get(runId);
    return record ? { ...record } : null;
  }

  async listRuns(opts?: {
    jobId?: string;
    sessionId?: string;
    state?: JobExecutionState;
    limit?: number;
  }): Promise<(JobRunRecord | WorkflowRunRecord)[]> {
    let results = [...this.runs.values()];

    if (opts?.jobId) {
      results = results.filter((r) => r.jobId === opts.jobId);
    }
    if (opts?.sessionId) {
      results = results.filter((r) => r.sessionId === opts.sessionId);
    }
    if (opts?.state) {
      results = results.filter((r) => r.state === opts.state);
    }

    // Sort by startedAt descending
    results.sort((a, b) => b.startedAt - a.startedAt);

    if (opts?.limit !== undefined && opts.limit > 0) {
      results = results.slice(0, opts.limit);
    }

    return results.map((r) => ({ ...r }));
  }

  async cleanup(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [runId, record] of this.runs) {
      if (record.startedAt < cutoff) {
        this.runs.delete(runId);
        removed++;
      }
    }
    return removed;
  }

  async requestCancel(runId: string): Promise<void> {
    this.cancelRequests.add(runId);
  }

  async isCancelRequested(runId: string): Promise<boolean> {
    return this.cancelRequests.has(runId);
  }

  async touchRunner(runnerId: string, ttlSeconds: number): Promise<void> {
    this.runnerExpiries.set(runnerId, Date.now() + ttlSeconds * 1000);
  }

  async isRunnerAlive(runnerId: string): Promise<boolean> {
    return (this.runnerExpiries.get(runnerId) ?? 0) > Date.now();
  }

  async claimRun(runId: string): Promise<boolean> {
    if (this.claims.has(runId)) return false;
    this.claims.add(runId);
    return true;
  }

  async holdLease(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const held = this.liveLease(key);
    if (held && held.value !== value) return false;
    this.leases.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async renewLease(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.liveLease(key)?.value !== value) return false;
    this.leases.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async releaseLease(key: string, value: string): Promise<void> {
    if (this.liveLease(key)?.value === value) this.leases.delete(key);
  }

  async listLeases(prefix: string): Promise<string[]> {
    return [...this.leases.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => this.liveLease(key)?.value)
      .filter((value): value is string => value !== undefined);
  }

  /** The lease `key`, unless it expired, which removes it. */
  private liveLease(key: string): { value: string; expiresAt: number } | undefined {
    const lease = this.leases.get(key);
    if (lease && lease.expiresAt <= Date.now()) {
      this.leases.delete(key);
      return undefined;
    }
    return lease;
  }

  async dispose(): Promise<void> {
    this.leases.clear();
    this.runs.clear();
    this.cancelRequests.clear();
    this.runnerExpiries.clear();
    this.claims.clear();
  }
}
