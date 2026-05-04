import { type FrontMcpLogger } from '../../common/interfaces/logger.interface';
import { type JobDynamicRecord } from '../../common/records/job.record';
import { type WorkflowDynamicRecord } from '../../common/records/workflow.record';
import { type JobDefinitionStore } from './job-definition.interface';

/** Minimal Redis client interface covering operations used by this store. */
export interface RedisDefinitionStoreLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  /** Optional graceful shutdown — present on ioredis. */
  quit?(): Promise<unknown>;
  /** Optional hard close — present on ioredis. */
  disconnect?(): void;
}

export interface RedisJobDefinitionStoreOptions {
  /**
   * If true, dispose() will close the Redis client. Set when the store
   * created the client itself (e.g. via the factory) so the lifecycle is
   * tied to the store. Defaults to false to preserve the existing
   * "shared client — don't close" behavior for callers that pass an
   * externally-managed client.
   */
  ownsClient?: boolean;
}

/**
 * Redis implementation of JobDefinitionStore.
 * Persists dynamic job/workflow definitions across restarts.
 */
export class RedisJobDefinitionStore implements JobDefinitionStore {
  private readonly client: RedisDefinitionStoreLike;
  private readonly keyPrefix: string;
  private readonly logger: FrontMcpLogger;
  private readonly ownsClient: boolean;
  private disposed = false;

  constructor(
    client: RedisDefinitionStoreLike,
    logger: FrontMcpLogger,
    keyPrefix = 'mcp:jobs:def:',
    options: RedisJobDefinitionStoreOptions = {},
  ) {
    this.client = client;
    this.logger = logger;
    this.keyPrefix = keyPrefix;
    this.ownsClient = options.ownsClient ?? false;
  }

  /**
   * Parse a Redis JSON payload, returning null on malformed input. Stale or
   * truncated values must not crash the caller — log + treat as missing so
   * the surrounding flow can recover.
   */
  private safeParse<T>(raw: string, jobId: string, kind: 'job' | 'workflow'): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch (e) {
      // Definition payloads can carry sensitive job/workflow data — log only
      // non-sensitive context so a malformed value never leaks into stdout.
      const message = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `[RedisJobDefinitionStore] Failed to parse ${kind} definition for "${jobId}": ${message}; payloadLength=${raw.length}`,
      );
      return null;
    }
  }

  private jobKey(jobId: string): string {
    return `${this.keyPrefix}job:${jobId}`;
  }

  private workflowKey(wfId: string): string {
    return `${this.keyPrefix}wf:${wfId}`;
  }

  // Note: saveDefinition is not atomic — the SET and SADD are separate commands.
  // If the process crashes between them, the index set may be inconsistent.
  // Adding pipeline/multi support would require extending RedisDefinitionStoreLike.
  async saveDefinition(record: JobDynamicRecord): Promise<void> {
    await this.client.set(this.jobKey(record.provide), JSON.stringify(record));
    await this.client.sadd(`${this.keyPrefix}jobs`, record.provide);
  }

  async getDefinition(jobId: string): Promise<JobDynamicRecord | null> {
    const raw = await this.client.get(this.jobKey(jobId));
    if (!raw) return null;
    return this.safeParse<JobDynamicRecord>(raw, jobId, 'job');
  }

  async listDefinitions(): Promise<JobDynamicRecord[]> {
    const ids = await this.client.smembers(`${this.keyPrefix}jobs`);
    // Fan out the per-id reads concurrently — the previous sequential loop
    // serialized N round-trips, which dominates list latency on large catalogs.
    const records = await Promise.all(ids.map((id) => this.getDefinition(id)));
    return records.filter((r): r is JobDynamicRecord => r !== null);
  }

  // Note: removeDefinition is not atomic (see saveDefinition comment).
  async removeDefinition(jobId: string): Promise<boolean> {
    const existed = await this.client.del(this.jobKey(jobId));
    await this.client.srem(`${this.keyPrefix}jobs`, jobId);
    return existed > 0;
  }

  // Note: saveWorkflowDefinition is not atomic (see saveDefinition comment).
  async saveWorkflowDefinition(record: WorkflowDynamicRecord): Promise<void> {
    await this.client.set(this.workflowKey(record.provide), JSON.stringify(record));
    await this.client.sadd(`${this.keyPrefix}workflows`, record.provide);
  }

  async getWorkflowDefinition(wfId: string): Promise<WorkflowDynamicRecord | null> {
    const raw = await this.client.get(this.workflowKey(wfId));
    if (!raw) return null;
    return this.safeParse<WorkflowDynamicRecord>(raw, wfId, 'workflow');
  }

  async listWorkflowDefinitions(): Promise<WorkflowDynamicRecord[]> {
    const ids = await this.client.smembers(`${this.keyPrefix}workflows`);
    // Same reasoning as listDefinitions — parallelize the per-id reads.
    const records = await Promise.all(ids.map((id) => this.getWorkflowDefinition(id)));
    return records.filter((r): r is WorkflowDynamicRecord => r !== null);
  }

  // Note: removeWorkflowDefinition is not atomic (see saveDefinition comment).
  async removeWorkflowDefinition(wfId: string): Promise<boolean> {
    const existed = await this.client.del(this.workflowKey(wfId));
    await this.client.srem(`${this.keyPrefix}workflows`, wfId);
    return existed > 0;
  }

  async dispose(): Promise<void> {
    // Idempotent: subsequent dispose() calls are a no-op.
    if (this.disposed) return;
    this.disposed = true;

    // Only close the client when we own it. Externally-supplied clients are
    // shared and must outlive this store; the factory passes ownsClient=true
    // when it creates the connection itself.
    if (!this.ownsClient) return;

    try {
      if (typeof this.client.quit === 'function') {
        await this.client.quit();
      } else if (typeof this.client.disconnect === 'function') {
        this.client.disconnect();
      }
    } catch (e) {
      this.logger.warn(`[RedisJobDefinitionStore] dispose: failed to close redis client: ${(e as Error).message}`);
    }
  }
}
