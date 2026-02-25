import { JobDefinitionStore } from './job-definition.interface';
import { JobDynamicRecord } from '../../common/records/job.record';
import { WorkflowDynamicRecord } from '../../common/records/workflow.record';

/**
 * In-memory implementation of JobDefinitionStore.
 * Definitions are lost on restart. Suitable for development.
 */
export class MemoryJobDefinitionStore implements JobDefinitionStore {
  private readonly jobs = new Map<string, JobDynamicRecord>();
  private readonly workflows = new Map<string, WorkflowDynamicRecord>();

  async saveDefinition(record: JobDynamicRecord): Promise<void> {
    this.jobs.set(record.provide, { ...record });
  }

  async getDefinition(jobId: string): Promise<JobDynamicRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async listDefinitions(): Promise<JobDynamicRecord[]> {
    return [...this.jobs.values()];
  }

  async removeDefinition(jobId: string): Promise<boolean> {
    return this.jobs.delete(jobId);
  }

  async saveWorkflowDefinition(record: WorkflowDynamicRecord): Promise<void> {
    this.workflows.set(record.provide, { ...record });
  }

  async getWorkflowDefinition(wfId: string): Promise<WorkflowDynamicRecord | null> {
    return this.workflows.get(wfId) ?? null;
  }

  async listWorkflowDefinitions(): Promise<WorkflowDynamicRecord[]> {
    return [...this.workflows.values()];
  }

  async removeWorkflowDefinition(wfId: string): Promise<boolean> {
    return this.workflows.delete(wfId);
  }

  async dispose(): Promise<void> {
    this.jobs.clear();
    this.workflows.clear();
  }
}
