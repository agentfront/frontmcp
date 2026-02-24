import { JobStateStore, JobRunRecord, WorkflowRunRecord, JobExecutionState } from './job-state.interface';

/**
 * In-memory implementation of JobStateStore.
 * Suitable for development and testing.
 */
export class MemoryJobStateStore implements JobStateStore {
  private readonly runs = new Map<string, JobRunRecord | WorkflowRunRecord>();

  async createRun(record: JobRunRecord | WorkflowRunRecord): Promise<void> {
    this.runs.set(record.runId, { ...record });
  }

  async updateRun(runId: string, updates: Partial<JobRunRecord | WorkflowRunRecord>): Promise<void> {
    const existing = this.runs.get(runId);
    if (!existing) return;
    this.runs.set(runId, { ...existing, ...updates });
  }

  async getRun(runId: string): Promise<JobRunRecord | WorkflowRunRecord | null> {
    return this.runs.get(runId) ?? null;
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

    return results;
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

  async dispose(): Promise<void> {
    this.runs.clear();
  }
}
