import { z } from '@frontmcp/lazy-zod';

import { type JobContext } from '../interfaces/job.interface';
import { type RawZodShape } from '../types';
import { type ToolInputType, type ToolOutputType } from './tool.metadata';

declare global {
  /**
   * Declarative metadata extends to the Job decorator.
   */
  interface ExtendFrontMcpJobMetadata {}
}

// ============================================
// Job Permission Model
// ============================================

export type JobPermissionAction = 'create' | 'read' | 'update' | 'delete' | 'execute' | 'list';

export interface JobPermission {
  action: JobPermissionAction;
  roles?: string[];
  scopes?: string[];
  custom?: (authInfo: Partial<Record<string, unknown>>) => boolean | Promise<boolean>;
}

const jobPermissionSchema = z.object({
  action: z.enum(['create', 'read', 'update', 'delete', 'execute', 'list']),
  roles: z.array(z.string()).optional(),
  scopes: z.array(z.string()).optional(),
  custom: z.function().optional(),
});

// ============================================
// Job Retry Configuration
// ============================================

export interface JobRetryConfig {
  /** Maximum number of retry attempts. Default: 3 */
  maxAttempts?: number;
  /** Initial backoff delay in ms. Default: 1000 */
  backoffMs?: number;
  /** Backoff multiplier. Default: 2 */
  backoffMultiplier?: number;
  /** Maximum backoff delay in ms. Default: 60000 */
  maxBackoffMs?: number;
}

const jobRetryConfigSchema = z.object({
  maxAttempts: z.number().int().min(1).optional().default(3),
  backoffMs: z.number().int().min(0).optional().default(1000),
  backoffMultiplier: z.number().min(1).optional().default(2),
  maxBackoffMs: z.number().int().min(0).optional().default(60000),
});

// ============================================
// Job Cleanup
// ============================================

/** Why an attempt stopped before it finished: the server shut down, it ran past its timeout, or the run was cancelled. */
export type JobInterruptReason = 'interrupt' | 'timeout' | 'cancel';

/** Undo what an interrupted attempt left behind; `job` is that attempt's instance (read `job.input` as your input type). */
export type JobCleanup = (
  job: JobContext<ToolInputType, ToolOutputType, unknown, unknown>,
  reason: JobInterruptReason,
) => void | Promise<void>;

/** A cleanup with its own time limit. */
export interface JobCleanupOptions {
  run: JobCleanup;
  /** How long the cleanup may take before the run ends without waiting for it. @default 3000 */
  timeoutMs?: number;
}

const jobCleanupSchema = z.union([
  z.function(),
  z.object({ run: z.function(), timeoutMs: z.number().int().positive().optional() }),
]);

// ============================================
// Job Metadata
// ============================================

/**
 * Declarative metadata describing what a Job contributes.
 * Jobs are pure executable units with strict input/output schemas.
 */
export interface JobMetadata<
  InSchema extends ToolInputType = ToolInputType,
  OutSchema extends ToolOutputType = ToolOutputType,
> extends ExtendFrontMcpJobMetadata {
  /**
   * Optional unique identifier for the job.
   * If omitted, derived from the class or file name.
   */
  id?: string;

  /**
   * Human-readable name of the job, used in UIs, logs, and discovery.
   */
  name: string;

  /**
   * Short summary describing what the job does.
   */
  description?: string;

  /**
   * Zod schema describing the expected input payload. REQUIRED.
   */
  inputSchema: InSchema;

  /**
   * Zod schema describing the expected output payload. REQUIRED.
   */
  outputSchema: OutSchema;

  /**
   * How long one attempt may run, in milliseconds, before it ends with `JobTimeoutError`; a run whose
   * last attempt timed out is `timed_out`. `0` means no limit. Default: `jobs.defaultTimeoutMs`
   * (300000, 5 min).
   */
  timeout?: number;

  /**
   * Runs when an attempt is interrupted (the server shuts down), times out or is cancelled, with the
   * attempt's instance, while `this.signal` is aborted. Its failure is logged and never changes how the
   * run ends. Pass `{ run, timeoutMs }` to bound it other than by the default 3000 ms.
   */
  cleanup?: JobCleanup | JobCleanupOptions;

  /**
   * Retry configuration for failed executions.
   */
  retry?: JobRetryConfig;

  /**
   * Tags for categorization and filtering.
   */
  tags?: string[];

  /**
   * Labels for fine-grained categorization.
   */
  labels?: Record<string, string>;

  /**
   * If true, the job will not be shown in discovery/listing.
   * Default: false
   */
  hideFromDiscovery?: boolean;

  /**
   * Permission rules for this job.
   */
  permissions?: JobPermission[];
}

export const frontMcpJobMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.instanceof(Object),
    outputSchema: z.instanceof(Object),
    timeout: z.number().int().min(0).optional(),
    cleanup: jobCleanupSchema.optional(),
    retry: jobRetryConfigSchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    hideFromDiscovery: z.boolean().optional().default(false),
    permissions: z.array(jobPermissionSchema).optional(),
  } satisfies RawZodShape<JobMetadata, ExtendFrontMcpJobMetadata>)
  .passthrough();
