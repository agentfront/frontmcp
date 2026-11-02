export type JobExecutionState =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying'
  | 'timed_out'
  | 'interrupted';

/** The states a run ends in. */
export const FINISHED_JOB_STATES: ReadonlySet<JobExecutionState> = new Set([
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'interrupted',
]);

/** The last progress a run's job reported with `this.progress()`. */
export interface JobRunProgress {
  progress: number;
  total?: number;
  message?: string;
}

export interface JobRunRecord {
  runId: string;
  jobId: string;
  jobName: string;
  sessionId?: string;
  /**
   * Subject that started the run. Run status carries the job's inputs and
   * results, so reads are scoped to the owner rather than to whoever guesses a
   * runId (GHSA-58v2-gpcc-jmqv).
   */
  ownerSub?: string;
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
  progress?: JobRunProgress;
  /** 1 when the run is created, and one more on each update. */
  revision?: number;
  /** When the store last wrote the run. */
  updatedAt?: number;
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
  /** Store a new run at revision 1. */
  createRun(record: JobRunRecord | WorkflowRunRecord): Promise<void>;
  /** Merge `updates` into the run (never its `runId`), bump its revision and stamp `updatedAt`; an unknown run is ignored. */
  updateRun(runId: string, updates: Partial<JobRunRecord | WorkflowRunRecord>): Promise<void>;
  getRun(runId: string): Promise<JobRunRecord | WorkflowRunRecord | null>;
  listRuns(opts?: {
    jobId?: string;
    sessionId?: string;
    state?: JobExecutionState;
    limit?: number;
  }): Promise<(JobRunRecord | WorkflowRunRecord)[]>;
  cleanup(olderThanMs: number): Promise<number>;
  /** Record that the run was cancelled, where every process sharing the store reads it; a run never loses it. */
  requestCancel(runId: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  dispose(): Promise<void>;
}
