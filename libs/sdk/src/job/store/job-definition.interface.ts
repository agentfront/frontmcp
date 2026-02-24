import { JobDynamicRecord } from '../../common/records/job.record';
import { WorkflowDynamicRecord } from '../../common/records/workflow.record';

export interface JobDefinitionStore {
  saveDefinition(record: JobDynamicRecord): Promise<void>;
  getDefinition(jobId: string): Promise<JobDynamicRecord | null>;
  listDefinitions(): Promise<JobDynamicRecord[]>;
  removeDefinition(jobId: string): Promise<boolean>;

  saveWorkflowDefinition(record: WorkflowDynamicRecord): Promise<void>;
  getWorkflowDefinition(wfId: string): Promise<WorkflowDynamicRecord | null>;
  listWorkflowDefinitions(): Promise<WorkflowDynamicRecord[]>;
  removeWorkflowDefinition(wfId: string): Promise<boolean>;

  dispose(): Promise<void>;
}
