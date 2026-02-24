import { z } from 'zod';
import { RawZodShape } from '../types';
import { ToolInputType, ToolOutputType } from './tool.metadata';
import { JobRetryConfig, JobPermission } from './job.metadata';

declare global {
  /**
   * Declarative metadata extends to the Workflow decorator.
   */
  interface ExtendFrontMcpWorkflowMetadata {}
}

// ============================================
// Workflow Step Context (data passing)
// ============================================

export interface WorkflowStepResult {
  outputs: Record<string, unknown>;
  state: 'completed' | 'failed' | 'skipped';
}

export interface WorkflowStepContext {
  get(alias: string): WorkflowStepResult;
}

// ============================================
// Workflow Step Definition
// ============================================

export interface WorkflowStep {
  /** Step identifier (like GitHub Actions `id`). */
  id: string;
  /** Reference to a registered job name. */
  jobName: string;
  /** Static input or dynamic callback from previous steps. */
  input?: Record<string, unknown> | ((steps: WorkflowStepContext) => Record<string, unknown>);
  /** Step IDs that must complete before this step. */
  dependsOn?: string[];
  /** Condition callback. Skip if returns false. */
  condition?: (steps: WorkflowStepContext) => boolean;
  /** Continue workflow even if this step fails. Default: false */
  continueOnError?: boolean;
  /** Per-step timeout override in ms. */
  timeout?: number;
  /** Per-step retry override. */
  retry?: JobRetryConfig;
}

// ============================================
// Workflow Trigger Types
// ============================================

export type WorkflowTriggerType = 'manual' | 'webhook' | 'event';

export interface WorkflowWebhookConfig {
  /** Custom webhook path. Default: /workflows/webhook/{name} */
  path?: string;
  /** Webhook secret for validation. */
  secret?: string;
  /** Allowed HTTP methods. Default: ['POST'] */
  methods?: ('GET' | 'POST')[];
}

// ============================================
// Workflow Metadata
// ============================================

/**
 * Declarative metadata describing a Workflow.
 * Workflows connect jobs into managed steps with triggers.
 */
export interface WorkflowMetadata extends ExtendFrontMcpWorkflowMetadata {
  /**
   * Optional unique identifier for the workflow.
   */
  id?: string;

  /**
   * Human-readable name of the workflow.
   */
  name: string;

  /**
   * Short summary describing what the workflow does.
   */
  description?: string;

  /**
   * Ordered step definitions.
   */
  steps: WorkflowStep[];

  /**
   * Trigger type. Default: 'manual'
   */
  trigger?: WorkflowTriggerType;

  /**
   * Webhook configuration (when trigger is 'webhook').
   */
  webhook?: WorkflowWebhookConfig;

  /**
   * Maximum total execution time in ms. Default: 600000 (10 min).
   */
  timeout?: number;

  /**
   * Maximum parallel step concurrency. Default: 5
   */
  maxConcurrency?: number;

  /**
   * Tags for categorization and filtering.
   */
  tags?: string[];

  /**
   * Labels for fine-grained categorization.
   */
  labels?: Record<string, string>;

  /**
   * If true, the workflow will not be shown in discovery/listing.
   * Default: false
   */
  hideFromDiscovery?: boolean;

  /**
   * Permission rules for this workflow.
   */
  permissions?: JobPermission[];

  /**
   * Workflow-level input schema (passed to first steps).
   */
  inputSchema?: ToolInputType;

  /**
   * Workflow-level output schema (from final steps).
   */
  outputSchema?: ToolOutputType;
}

const workflowStepSchema = z.object({
  id: z.string().min(1),
  jobName: z.string().min(1),
  input: z.union([z.record(z.string(), z.unknown()), z.function()]).optional(),
  dependsOn: z.array(z.string()).optional(),
  condition: z.function().optional(),
  continueOnError: z.boolean().optional().default(false),
  timeout: z.number().int().min(0).optional(),
  retry: z
    .object({
      maxAttempts: z.number().int().min(1).optional().default(3),
      backoffMs: z.number().int().min(0).optional().default(1000),
      backoffMultiplier: z.number().min(1).optional().default(2),
      maxBackoffMs: z.number().int().min(0).optional().default(60000),
    })
    .optional(),
});

const workflowWebhookConfigSchema = z.object({
  path: z
    .string()
    .regex(/^\/[a-zA-Z0-9\-._~:@!$&'()*+,;=\/]*$/, 'Webhook path must be a valid relative URI path starting with /')
    .optional(),
  /** NOTE: Webhook secrets should be stripped from discovery/listing responses. */
  secret: z.string().optional(),
  methods: z.array(z.enum(['GET', 'POST'])).optional(),
});

export const frontMcpWorkflowMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    steps: z.array(workflowStepSchema).min(1),
    trigger: z.enum(['manual', 'webhook', 'event']).optional().default('manual'),
    webhook: workflowWebhookConfigSchema.optional(),
    timeout: z.number().int().min(0).optional().default(600000),
    maxConcurrency: z.number().int().min(1).optional().default(5),
    tags: z.array(z.string().min(1)).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    hideFromDiscovery: z.boolean().optional().default(false),
    permissions: z
      .array(
        z.object({
          action: z.enum(['create', 'read', 'update', 'delete', 'execute', 'list']),
          roles: z.array(z.string()).optional(),
          scopes: z.array(z.string()).optional(),
          custom: z.function().optional(),
        }),
      )
      .optional(),
    inputSchema: z.instanceof(Object).optional(),
    outputSchema: z.instanceof(Object).optional(),
  } satisfies RawZodShape<WorkflowMetadata, ExtendFrontMcpWorkflowMetadata>)
  .passthrough();
