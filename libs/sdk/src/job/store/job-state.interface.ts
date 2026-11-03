import { type JobRunner } from '../../common/metadata/job.metadata';

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

/** The process that runs a run, and the id it keeps its heartbeat under in the store. */
export interface JobRunnerInfo {
  kind: JobRunner;
  id: string;
  pid: number;
  hostname?: string;
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
  /** The process running the run; a run without one was written before runners were recorded. */
  runner?: JobRunnerInfo;
  /** The scope whose job registry holds the job. */
  scopeId?: string;
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
  /**
   * Record that the run was cancelled, where every process sharing the store reads it; a run never loses it.
   * A store without it is read for a run whose state is `cancelled`.
   */
  requestCancel?(runId: string): Promise<void>;
  isCancelRequested?(runId: string): Promise<boolean>;
  /**
   * Record that a runner is alive for `ttlSeconds`, expired by the store's own TTL. Without it (and
   * `isRunnerAlive`) a runner is judged by its pid on its own host only.
   */
  touchRunner?(runnerId: string, ttlSeconds: number): Promise<void>;
  isRunnerAlive?(runnerId: string): Promise<boolean>;
  /** True for the one caller that claims an orphaned run, so only one process ends it and runs its cleanup. */
  claimRun?(runId: string): Promise<boolean>;
  dispose(): Promise<void>;
}
