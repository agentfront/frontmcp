import {
  httpRespond,
  HttpRoute,
  HttpRouteContext,
  WorkflowTriggerPrincipal,
  type FrontMcpLogger,
  type HttpOutput,
  type HttpRouteType,
  type ScopeEntry,
  type ServerRequest,
} from '../../common';
import { type WorkflowEntry } from '../../common/entries/workflow.entry';
import { InvalidInputError, JobNotAuthorizedError } from '../../errors';
import { jobExecutionManagerOf } from '../../job/job-run-access';
import { resolveWorkflowWebhook, webhookWorkflows, type ResolvedWorkflowWebhook } from './workflow-triggers';
import { verifyWorkflowWebhook, WorkflowWebhookReplayGuard } from './workflow-webhook.signature';

/** A webhook route, with the workflow it starts. */
export interface WorkflowWebhookRoute {
  target: HttpRouteType;
  workflow: string;
  method: 'GET' | 'POST';
  path: string;
}

/**
 * The routes of a scope's webhook workflows, one for each workflow and method, served by the `http:route` flow (the
 * IP filter, the global rate limit, then the route). A workflow's methods share its replay guard, and each workflow
 * has a secret of its own, so a signed request starts one run of one workflow.
 */
export function workflowWebhookRoutes(workflows: readonly WorkflowEntry[]): WorkflowWebhookRoute[] {
  return webhookWorkflows(workflows).flatMap((workflow) => {
    const webhook = resolveWorkflowWebhook(workflow);
    const replays = new WorkflowWebhookReplayGuard();
    return webhook.methods.map((method) => ({
      target: webhookRoute(workflow.name, webhook, method, replays),
      workflow: workflow.name,
      method,
      path: webhook.path,
    }));
  });
}

function webhookRoute(
  workflowName: string,
  webhook: ResolvedWorkflowWebhook,
  method: 'GET' | 'POST',
  replays: WorkflowWebhookReplayGuard,
): HttpRouteType {
  @HttpRoute({ method, path: webhook.path, auth: 'public' })
  class WorkflowWebhookRouteContext extends HttpRouteContext {
    handle(): Promise<HttpOutput> {
      return startWebhookRun(this.request, this.scope, this.logger, { workflowName, webhook, replays });
    }
  }
  return WorkflowWebhookRouteContext;
}

interface WebhookTarget {
  workflowName: string;
  webhook: ResolvedWorkflowWebhook;
  replays: WorkflowWebhookReplayGuard;
}

const decoder = new TextDecoder();

/**
 * Start a run of the workflow for a webhook request: a JSON body within `maxBodyBytes`, signed with the workflow's
 * secret, as its input, under the workflow's `create` and `execute` rules for the role `webhook:<workflow>`.
 */
async function startWebhookRun(
  request: ServerRequest,
  scope: ScopeEntry,
  logger: FrontMcpLogger,
  { workflowName, webhook, replays }: WebhookTarget,
): Promise<HttpOutput> {
  const hasBody = request.method !== 'GET';
  if (hasBody && mediaTypeOf(request.headers['content-type']) !== 'application/json') {
    return problem(415, 'The body must be application/json');
  }
  const body = (hasBody && request.bodyBytes) || new Uint8Array();
  if (body.length > webhook.maxBodyBytes) return problem(413, 'Payload too large');

  const refusal = verifyWorkflowWebhook({ headers: request.headers, body }, webhook.secret, replays);
  if (refusal) {
    logger.warn(`Webhook of workflow "${workflowName}" refused a request: ${refusal}`);
    return httpRespond.unauthorized();
  }

  const input = jsonObjectOf(body);
  if (!input) return problem(400, 'The body must be a JSON object');

  const manager = jobExecutionManagerOf(scope);
  const workflow = scope.workflows?.findByName(workflowName);
  const jobs = scope.jobs;
  if (!manager || !workflow || !jobs) return problem(503, 'Workflows are not available');

  const principal = new WorkflowTriggerPrincipal('webhook', workflowName);
  try {
    const run = await manager.executeWorkflow(workflow, jobs, {
      background: true,
      authInfo: principal.toAuthInfo(),
      authoritiesContextBuilder: scope.authoritiesContextBuilder,
      workflowInput: input,
    });
    return httpRespond.json({ runId: run.runId, state: run.state }, { status: 202 });
  } catch (error) {
    if (error instanceof JobNotAuthorizedError) {
      logger.warn(
        `Webhook of workflow "${workflowName}": its create or execute rules don't allow the role ` +
          `"${principal.role}"; add it to those rules' roles to let the webhook start runs`,
      );
      return httpRespond.forbidden();
    }
    if (error instanceof InvalidInputError) {
      return httpRespond.json({ error: error.message, issues: error.validationErrors }, { status: 400 });
    }
    throw error;
  }
}

function problem(status: number, error: string): HttpOutput {
  return httpRespond.json({ error }, { status });
}

function mediaTypeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/** The body as a JSON object: `{}` when it is empty, undefined when it is not an object. */
function jsonObjectOf(body: Uint8Array): Record<string, unknown> | undefined {
  if (body.length === 0) return {};
  try {
    const value: unknown = JSON.parse(decoder.decode(body));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
