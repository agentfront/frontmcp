import { type NamespacedStorage } from '@frontmcp/utils';

import { type JobDynamicRecord } from '../../common/records/job.record';
import { type WorkflowDynamicRecord } from '../../common/records/workflow.record';
import { type JobDefinitionStore } from './job-definition.interface';

/**
 * A JobDefinitionStore on a `@frontmcp/utils` storage, such as the SQLite storage several processes on
 * one machine share: each definition is one JSON value under `job:<id>` or `wf:<id>`. The store owns
 * the storage and disconnects it on dispose.
 */
export class StorageJobDefinitionStore implements JobDefinitionStore {
  constructor(private readonly storage: NamespacedStorage) {}

  async saveDefinition(record: JobDynamicRecord): Promise<void> {
    await this.storage.set(`job:${record.provide}`, JSON.stringify(record));
  }

  async getDefinition(jobId: string): Promise<JobDynamicRecord | null> {
    return this.read<JobDynamicRecord>(`job:${jobId}`);
  }

  async listDefinitions(): Promise<JobDynamicRecord[]> {
    return this.list<JobDynamicRecord>('job:*');
  }

  async removeDefinition(jobId: string): Promise<boolean> {
    return this.storage.delete(`job:${jobId}`);
  }

  async saveWorkflowDefinition(record: WorkflowDynamicRecord): Promise<void> {
    await this.storage.set(`wf:${record.provide}`, JSON.stringify(record));
  }

  async getWorkflowDefinition(wfId: string): Promise<WorkflowDynamicRecord | null> {
    return this.read<WorkflowDynamicRecord>(`wf:${wfId}`);
  }

  async listWorkflowDefinitions(): Promise<WorkflowDynamicRecord[]> {
    return this.list<WorkflowDynamicRecord>('wf:*');
  }

  async removeWorkflowDefinition(wfId: string): Promise<boolean> {
    return this.storage.delete(`wf:${wfId}`);
  }

  async dispose(): Promise<void> {
    await this.storage.disconnect();
  }

  private async read<T>(key: string): Promise<T | null> {
    const raw = await this.storage.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  private async list<T>(pattern: string): Promise<T[]> {
    const keys = await this.storage.keys(pattern);
    if (keys.length === 0) return [];
    const values = await this.storage.mget(keys);
    return values.filter((raw): raw is string => raw !== null).map((raw) => JSON.parse(raw) as T);
  }
}
