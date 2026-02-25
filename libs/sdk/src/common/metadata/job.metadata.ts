import { z } from 'zod';
import { RawZodShape } from '../types';
import { ToolInputType, ToolOutputType } from './tool.metadata';

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
   * Maximum execution time in milliseconds. Default: 300000 (5 min).
   */
  timeout?: number;

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
    timeout: z.number().int().min(0).optional().default(300000),
    retry: jobRetryConfigSchema.optional(),
    tags: z.array(z.string().min(1)).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    hideFromDiscovery: z.boolean().optional().default(false),
    permissions: z.array(jobPermissionSchema).optional(),
  } satisfies RawZodShape<JobMetadata, ExtendFrontMcpJobMetadata>)
  .passthrough();
