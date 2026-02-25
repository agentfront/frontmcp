export type JobExecutionState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying';

export interface JobRunRecord {
  runId: string;
  jobId: string;
  jobName: string;
  sessionId?: string;
  state: JobExecutionState;
  input: unknown;
  result?: unknown;
  error?: { message: string; name: string; stack?: string };
  startedAt: number;
  completedAt?: number;
  attempt: number;
  maxAttempts: number;
  logs: string[];
  background: boolean;
}

export interface WorkflowRunRecord extends JobRunRecord {
  workflowName: string;
  stepResults: Record<
    string,
    {
      jobName: string;
      state: JobExecutionState;
      outputs?: Record<string, unknown>;
      error?: { message: string };
      startedAt: number;
      completedAt?: number;
    }
  >;
}

export interface JobStateStore {
  createRun(record: JobRunRecord | WorkflowRunRecord): Promise<void>;
  updateRun(runId: string, updates: Partial<JobRunRecord | WorkflowRunRecord>): Promise<void>;
  getRun(runId: string): Promise<JobRunRecord | WorkflowRunRecord | null>;
  listRuns(opts?: {
    jobId?: string;
    sessionId?: string;
    state?: JobExecutionState;
    limit?: number;
  }): Promise<(JobRunRecord | WorkflowRunRecord)[]>;
  cleanup(olderThanMs: number): Promise<number>;
  dispose(): Promise<void>;
}
