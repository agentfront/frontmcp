import { type WorkflowEntry } from '../../common/entries/workflow.entry';
import { isHttpRoutePath } from '../../common/metadata/http-route.metadata';
import { type WorkflowWebhookConfig } from '../../common/metadata/workflow.metadata';
import { WorkflowTriggerConfigError } from '../../errors/workflow.errors';

/** The shortest `webhook.secret` a workflow may have. */
export const MIN_WORKFLOW_WEBHOOK_SECRET_LENGTH = 32;

/** The largest webhook body a workflow accepts when it sets no `webhook.maxBodyBytes`: 1 MiB. */
export const DEFAULT_WORKFLOW_WEBHOOK_MAX_BODY_BYTES = 1_048_576;

/** A webhook workflow's route, with its defaults filled in. */
export interface ResolvedWorkflowWebhook {
  path: string;
  secret: string;
  methods: readonly ('GET' | 'POST')[];
  maxBodyBytes: number;
}

/** The path a webhook workflow's route is served at: `webhook.path`, else `/workflows/webhook/{name}`. */
export function workflowWebhookPath(workflow: WorkflowEntry): string {
  return workflow.metadata.webhook?.path ?? `/workflows/webhook/${encodeURIComponent(workflow.name)}`;
}

/** The workflows a webhook starts. */
export function webhookWorkflows(workflows: readonly WorkflowEntry[]): WorkflowEntry[] {
  return workflows.filter((workflow) => workflow.metadata.trigger === 'webhook');
}

/** The workflows an event starts. */
export function eventWorkflows(workflows: readonly WorkflowEntry[]): WorkflowEntry[] {
  return workflows.filter((workflow) => workflow.metadata.trigger === 'event');
}

/** The event that starts a `trigger: 'event'` workflow: its `event`, else its name. */
export function workflowEventName(workflow: WorkflowEntry): string {
  return workflow.metadata.event ?? workflow.name;
}

/**
 * Check the triggers of a scope's workflows when the server starts.
 *
 * @throws WorkflowTriggerConfigError for a webhook workflow without a usable secret, path or methods, for two that
 *   share a secret, and for a `webhook` or an `event` on a workflow whose trigger isn't theirs
 */
export function assertWorkflowTriggers(workflows: readonly WorkflowEntry[]): void {
  const workflowsBySecret = new Map<string, string>();
  for (const workflow of workflows) {
    if (workflow.metadata.trigger === 'webhook') {
      const { secret } = resolveWorkflowWebhook(workflow);
      const sharedWith = workflowsBySecret.get(secret);
      if (sharedWith !== undefined) {
        throw new WorkflowTriggerConfigError(
          workflow.name,
          `its webhook.secret is also workflow "${sharedWith}"'s: give each webhook a secret of its own, so a ` +
            'request signed for one cannot start the other',
        );
      }
      workflowsBySecret.set(secret, workflow.name);
    } else if (workflow.metadata.webhook !== undefined) {
      throw new WorkflowTriggerConfigError(
        workflow.name,
        "webhook is set, but trigger is not 'webhook': set trigger: 'webhook' to serve it, or remove webhook",
      );
    }
    if (workflow.metadata.event !== undefined && workflow.metadata.trigger !== 'event') {
      throw new WorkflowTriggerConfigError(
        workflow.name,
        "event is set, but trigger is not 'event': set trigger: 'event' to listen to it, or remove event",
      );
    }
  }
}

/**
 * A webhook workflow's route, with its defaults filled in.
 *
 * @throws WorkflowTriggerConfigError when the secret is missing or short, the path isn't literal, or no method is set
 */
export function resolveWorkflowWebhook(workflow: WorkflowEntry): ResolvedWorkflowWebhook {
  const webhook: WorkflowWebhookConfig = workflow.metadata.webhook ?? {};
  const fail = (reason: string) => new WorkflowTriggerConfigError(workflow.name, reason);
  if (!webhook.secret) {
    throw fail(
      "trigger: 'webhook' needs webhook.secret, the shared secret its requests are signed with, and the server " +
        'does not start without it',
    );
  }
  if (webhook.secret.length < MIN_WORKFLOW_WEBHOOK_SECRET_LENGTH) {
    throw fail(
      `webhook.secret must be at least ${MIN_WORKFLOW_WEBHOOK_SECRET_LENGTH} characters ` +
        '(make one with: openssl rand -hex 32)',
    );
  }
  const path = workflowWebhookPath(workflow);
  if (!isHttpRoutePath(path) || path.split('/').some((segment) => segment.startsWith(':'))) {
    throw fail(`webhook.path ${path} must start with "/" and hold literal segments only, with no :name parameter`);
  }
  const methods = webhook.methods ?? ['POST'];
  if (methods.length === 0) throw fail('webhook.methods must name GET, POST or both');
  return {
    path,
    secret: webhook.secret,
    methods,
    maxBodyBytes: webhook.maxBodyBytes ?? DEFAULT_WORKFLOW_WEBHOOK_MAX_BODY_BYTES,
  };
}
