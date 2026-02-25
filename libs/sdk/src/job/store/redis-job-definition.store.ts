import { JobDefinitionStore } from './job-definition.interface';
import { JobDynamicRecord } from '../../common/records/job.record';
import { WorkflowDynamicRecord } from '../../common/records/workflow.record';
import { FrontMcpLogger } from '../../common/interfaces/logger.interface';

/** Minimal Redis client interface covering operations used by this store. */
export interface RedisDefinitionStoreLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
}

/**
 * Redis implementation of JobDefinitionStore.
 * Persists dynamic job/workflow definitions across restarts.
 */
export class RedisJobDefinitionStore implements JobDefinitionStore {
  private readonly client: RedisDefinitionStoreLike;
  private readonly keyPrefix: string;
  private readonly logger: FrontMcpLogger;

  constructor(client: RedisDefinitionStoreLike, logger: FrontMcpLogger, keyPrefix = 'mcp:jobs:def:') {
    this.client = client;
    this.logger = logger;
    this.keyPrefix = keyPrefix;
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
    return JSON.parse(raw);
  }

  async listDefinitions(): Promise<JobDynamicRecord[]> {
    const ids = await this.client.smembers(`${this.keyPrefix}jobs`);
    const results: JobDynamicRecord[] = [];
    for (const id of ids) {
      const record = await this.getDefinition(id);
      if (record) results.push(record);
    }
    return results;
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
    return JSON.parse(raw);
  }

  async listWorkflowDefinitions(): Promise<WorkflowDynamicRecord[]> {
    const ids = await this.client.smembers(`${this.keyPrefix}workflows`);
    const results: WorkflowDynamicRecord[] = [];
    for (const id of ids) {
      const record = await this.getWorkflowDefinition(id);
      if (record) results.push(record);
    }
    return results;
  }

  // Note: removeWorkflowDefinition is not atomic (see saveDefinition comment).
  async removeWorkflowDefinition(wfId: string): Promise<boolean> {
    const existed = await this.client.del(this.workflowKey(wfId));
    await this.client.srem(`${this.keyPrefix}workflows`, wfId);
    return existed > 0;
  }

  async dispose(): Promise<void> {
    // Don't close shared redis client
  }
}
