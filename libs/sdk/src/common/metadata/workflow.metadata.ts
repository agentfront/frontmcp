import { internalZ as z } from '@frontmcp/lazy-zod';

import { type RawZodShape } from '../types';
import { MAX_JOB_TIMER_MS, timerLimitMessage, type JobPermission, type JobRetryConfig } from './job.metadata';
import { type ToolInputType, type ToolOutputType } from './tool.metadata';

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
  /**
   * The step job's input: a static object, or a function of the earlier steps' results and the workflow's input.
   * Without it, the step gets the workflow's input.
   */
  input?:
    | Record<string, unknown>
    | ((steps: WorkflowStepContext, workflowInput: Record<string, unknown>) => Record<string, unknown>);
  /**
   * Step IDs that must complete before this step. A step skipped by its `condition` counts as done; when
   * one of them fails (without `continueOnError`), or is skipped because a step it depends on failed,
   * this step is skipped too.
   */
  dependsOn?: string[];
  /** Whether the step runs, from the earlier steps' results and the workflow's input; `false` skips it. */
  condition?: (steps: WorkflowStepContext, workflowInput: Record<string, unknown>) => boolean;
  /** Let the steps that depend on this one run even if it fails. Default: false */
  continueOnError?: boolean;
  /** Per-step timeout override in ms. */
  timeout?: number;
  /** Per-step retry override. Without it the job's `retry` applies; without either, the step is tried once. */
  retry?: JobRetryConfig;
}

// ============================================
// Workflow Trigger Types
// ============================================

/**
 * What starts a workflow's runs besides `execute_workflow`, which runs every workflow: `'manual'` nothing else,
 * `'webhook'` a signed HTTP request to its `webhook.path`, `'event'` its `event` emitted on the scope's event bus
 * (`scope.channelEventBus.emit(event, payload)`), `'schedule'` the times of its `schedule.cron`.
 */
export type WorkflowTriggerType = 'manual' | 'webhook' | 'event' | 'schedule';

/**
 * The HTTP route of a workflow with `trigger: 'webhook'`. Each request must be signed with `secret`: an
 * `X-FrontMCP-Timestamp` header with the time in Unix seconds, and an `X-FrontMCP-Signature` header with `v1=` and
 * the hex HMAC-SHA256 of `<timestamp>.<body>`, within 5 minutes of the server's clock and never sent before. A
 * signed request's JSON body is the run's input, and the route answers `202 { runId, state: 'pending' }`. The run's
 * caller is the role `webhook:<workflow>`, which the workflow's `execute` rules must allow when it has any.
 */
export interface WorkflowWebhookConfig {
  /** The route's path, literal segments only. Default: `/workflows/webhook/{name}` */
  path?: string;
  /**
   * The shared secret requests are signed with, at least 32 characters. Required: a webhook workflow without one
   * refuses to start the server.
   */
  secret?: string;
  /** The methods the route answers; a GET has no body, so its run's input is `{}`. Default: ['POST'] */
  methods?: ('GET' | 'POST')[];
  /** The largest body accepted, in bytes; a larger one gets 413. Default: 1048576 (1 MiB) */
  maxBodyBytes?: number;
}

/**
 * When a workflow with `trigger: 'schedule'` runs. Each scheduled time starts one background run among all the
 * processes of the server (all its machines when it has a top-level `redis`, else those of one machine), with `input`
 * as its input. The run's caller is the role `schedule:<workflow>`, which the workflow's `execute` rules must allow
 * when it has any.
 */
export interface WorkflowScheduleConfig {
  /**
   * A cron expression: `minute hour day-of-month month day-of-week` (`'0 9 * * 1-5'`), with seconds as an optional
   * first field. One that can't be read refuses to start the server.
   */
  cron: string;
  /** The IANA time zone `cron` is read in, such as `'Europe/Berlin'`. Default: 'UTC' */
  timezone?: string;
  /** The input of each scheduled run. Default: {} */
  input?: Record<string, unknown>;
}

// ============================================
// Workflow Metadata
// ============================================

/**
 * Declarative metadata describing a Workflow.
 * Workflows connect jobs into managed steps, which `execute_workflow` or the workflow's trigger starts.
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
   * What starts the workflow's runs besides `execute_workflow` (see {@link WorkflowTriggerType}). Default: 'manual'
   */
  trigger?: WorkflowTriggerType;

  /**
   * The HTTP route of a `trigger: 'webhook'` workflow, whose `secret` it needs; set without that trigger, the
   * server refuses to start.
   */
  webhook?: WorkflowWebhookConfig;

  /**
   * The event that starts a `trigger: 'event'` workflow when the scope's event bus emits it
   * (`this.scope.channelEventBus?.emit(event, payload)`): an object payload is the run's input, and the run's caller is
   * the role `event:<event>`, which the workflow's `execute` rules must allow when it has any. Default: the
   * workflow's name. Set without that trigger, the server refuses to start.
   */
  event?: string;

  /**
   * When a `trigger: 'schedule'` workflow runs, which needs its `cron`; set without that trigger, the server refuses
   * to start.
   */
  schedule?: WorkflowScheduleConfig;

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
   * The workflow's input, checked when a run starts: input that doesn't match fails with `INVALID_INPUT` before the
   * run exists. The parsed input goes to each step without an `input`, and to each step's `input` and `condition`
   * functions. Without it, the input is passed on as given.
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
  timeout: z.number().int().min(0).max(MAX_JOB_TIMER_MS, timerLimitMessage('step timeout')).optional(),
  retry: z
    .object({
      maxAttempts: z.number().int().min(1).optional().default(3),
      backoffMs: z.number().int().min(0).optional().default(1000),
      backoffMultiplier: z.number().min(1).optional().default(2),
      maxBackoffMs: z.number().int().min(0).optional().default(60000),
    })
    .optional(),
});

/** RFC 3986 relative-path characters: unreserved / sub-delims / ":" / "@" / "/" */
const WEBHOOK_PATH_PATTERN = /^\/[a-zA-Z0-9\-._~:@!$&'()*+,;=/]*$/;

function isValidWebhookPath(path: string): boolean {
  return WEBHOOK_PATH_PATTERN.test(path);
}

const workflowWebhookConfigSchema = z.object({
  path: z
    .string()
    .optional()
    .refine((val) => val === undefined || isValidWebhookPath(val), {
      message: 'Webhook path must be a valid RFC 3986 relative path starting with /',
    }),
  /** NOTE: Webhook secrets should be stripped from discovery/listing responses. */
  secret: z.string().optional(),
  methods: z
    .array(z.enum(['GET', 'POST']))
    .optional()
    .default(['POST']),
  maxBodyBytes: z.number().int().positive().optional(),
});

const workflowScheduleConfigSchema = z.object({
  cron: z.string().min(1),
  timezone: z.string().min(1).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export const frontMcpWorkflowMetadataSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    steps: z.array(workflowStepSchema).min(1),
    trigger: z.enum(['manual', 'webhook', 'event', 'schedule']).optional().default('manual'),
    webhook: workflowWebhookConfigSchema.optional(),
    event: z.string().min(1).optional(),
    schedule: workflowScheduleConfigSchema.optional(),
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
