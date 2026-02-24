import { JobStateStore, JobRunRecord, WorkflowRunRecord, JobExecutionState } from './job-state.interface';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';

/** Minimal Redis client interface covering operations used by this store. */
export interface RedisStateStoreLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Redis implementation of JobStateStore.
 * Uses Redis hashes with TTL for production deployments.
 */
export class RedisJobStateStore implements JobStateStore {
  private readonly client: RedisStateStoreLike;
  private readonly keyPrefix: string;
  private readonly logger: FrontMcpLogger;
  private readonly ttlSeconds: number;

  constructor(client: RedisStateStoreLike, logger: FrontMcpLogger, keyPrefix = 'mcp:jobs:', ttlSeconds = 86400) {
    this.client = client;
    this.logger = logger;
    this.keyPrefix = keyPrefix;
    this.ttlSeconds = ttlSeconds;
  }

  private key(runId: string): string {
    return `${this.keyPrefix}run:${runId}`;
  }

  private indexKey(field: string, value: string): string {
    return `${this.keyPrefix}idx:${field}:${value}`;
  }

  async createRun(record: JobRunRecord | WorkflowRunRecord): Promise<void> {
    const key = this.key(record.runId);
    const data = JSON.stringify(record);
    await this.client.set(key, data, 'EX', this.ttlSeconds);

    // Index by jobId and sessionId for queries
    if (record.jobId) {
      await this.client.sadd(this.indexKey('jobId', record.jobId), record.runId);
    }
    if (record.sessionId) {
      await this.client.sadd(this.indexKey('sessionId', record.sessionId), record.runId);
    }
  }

  async updateRun(runId: string, updates: Partial<JobRunRecord | WorkflowRunRecord>): Promise<void> {
    const key = this.key(runId);
    const raw = await this.client.get(key);
    if (!raw) return;

    const existing = JSON.parse(raw);
    const updated = { ...existing, ...updates };
    await this.client.set(key, JSON.stringify(updated), 'EX', this.ttlSeconds);
  }

  async getRun(runId: string): Promise<JobRunRecord | WorkflowRunRecord | null> {
    const raw = await this.client.get(this.key(runId));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async listRuns(opts?: {
    jobId?: string;
    sessionId?: string;
    state?: JobExecutionState;
    limit?: number;
  }): Promise<(JobRunRecord | WorkflowRunRecord)[]> {
    let runIds: string[] = [];

    if (opts?.jobId) {
      runIds = await this.client.smembers(this.indexKey('jobId', opts.jobId));
    } else if (opts?.sessionId) {
      runIds = await this.client.smembers(this.indexKey('sessionId', opts.sessionId));
    } else {
      // Scan for all run keys (expensive, use with caution)
      const keys = await this.client.keys(`${this.keyPrefix}run:*`);
      runIds = keys.map((k: string) => k.replace(`${this.keyPrefix}run:`, ''));
    }

    const results: (JobRunRecord | WorkflowRunRecord)[] = [];
    for (const runId of runIds) {
      const record = await this.getRun(runId);
      if (!record) continue;
      if (opts?.state && record.state !== opts.state) continue;
      results.push(record);
    }

    results.sort((a, b) => b.startedAt - a.startedAt);

    if (opts?.limit) {
      return results.slice(0, opts.limit);
    }

    return results;
  }

  async cleanup(olderThanMs: number): Promise<number> {
    // Redis TTL handles cleanup; this is for manual purge
    const cutoff = Date.now() - olderThanMs;
    const keys = await this.client.keys(`${this.keyPrefix}run:*`);
    let removed = 0;

    for (const key of keys) {
      const raw = await this.client.get(key);
      if (!raw) continue;
      const record = JSON.parse(raw);
      if (record.startedAt < cutoff) {
        await this.client.del(key);

        // Remove runId from index sets to prevent stale references
        const runId = key.replace(`${this.keyPrefix}run:`, '');
        if (record.jobId) {
          await this.client.srem(this.indexKey('jobId', record.jobId), runId);
        }
        if (record.sessionId) {
          await this.client.srem(this.indexKey('sessionId', record.sessionId), runId);
        }

        removed++;
      }
    }

    return removed;
  }

  async dispose(): Promise<void> {
    // Don't close shared redis client
  }
}
