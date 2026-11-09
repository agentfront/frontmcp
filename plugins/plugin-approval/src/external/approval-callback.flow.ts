/**
 * `POST <webhook.callbackPath>`: where an approval system sends its decisions, through a hookable flow.
 *
 * @module @frontmcp/plugin-approval
 */

import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  enforceGlobalRateLimit,
  enforceIpFilter,
  Flow,
  FlowBase,
  FlowHooksOf,
  httpInputSchema,
  HttpJsonSchema,
  normalizeEntryPrefix,
  normalizeScopeBase,
  type FlowPlan,
  type FlowRunOptions,
  type ScopeEntry,
  type ServerRequest,
} from '@frontmcp/sdk';

import { ApprovalConfigurationError } from '../approval';
import type { CallbackAnswer, CallbackRequest } from './webhook-approver';

const plan = {
  pre: ['checkIpFilter', 'acquireQuota'],
  execute: ['handleCallback'],
} as const satisfies FlowPlan<string>;

export const approvalCallbackStateSchema = z.object({});

declare global {
  interface ExtendFlows {
    'approval:webhook-callback': FlowRunOptions<
      ApprovalCallbackFlow,
      typeof plan,
      typeof httpInputSchema,
      typeof HttpJsonSchema,
      typeof approvalCallbackStateSchema
    >;
  }
}

/** Takes the decisions posted to one callback path. */
export interface ApprovalCallbackHandler {
  handleCallback(request: CallbackRequest): Promise<CallbackAnswer>;
}

/** The callback paths each scope serves, and who handles each. */
const callbackRoutes = new WeakMap<ScopeEntry, Map<string, ApprovalCallbackHandler>>();

const name = 'approval:webhook-callback' as const;
const { Stage } = FlowHooksOf(name);

@Flow({
  name,
  plan,
  access: 'public',
  inputSchema: httpInputSchema,
  outputSchema: HttpJsonSchema,
  middleware: { method: 'POST' },
})
export default class ApprovalCallbackFlow extends FlowBase<typeof name> {
  static canActivate(request: ServerRequest, scope: ScopeEntry): boolean {
    return callbackRoutes.get(scope)?.has(request.path) ?? false;
  }

  @Stage('checkIpFilter')
  async checkIpFilter() {
    enforceIpFilter(this.scope, this.tryGetContext()?.metadata.clientIp);
  }

  @Stage('acquireQuota')
  async acquireQuota() {
    await enforceGlobalRateLimit(this.scope, this.tryGetContext());
  }

  @Stage('handleCallback')
  async handleCallback() {
    const request = this.rawInput.request as ServerRequest;
    const handler = callbackRoutes.get(this.scope)?.get(request.path);
    if (!handler) return this.next();
    this.respond(await handler.handleCallback({ headers: request.headers, bodyBytes: request.bodyBytes }));
  }
}

/** The paths of the scope's MCP endpoint, which a callback path must not take. */
function mcpPaths(scope: ScopeEntry): string[] {
  const base = `${normalizeEntryPrefix(scope.entryPath)}${normalizeScopeBase(scope.routeBase)}`;
  return [base || '/', `${base}/sse`, `${base}/message`, `${base}/server-card`];
}

/**
 * Serves `POST <path>` on the scope for `handler`. Throws `ApprovalConfigurationError` for a path another
 * `ApprovalPlugin` already serves, the MCP endpoint's, or one under `/oauth` or `/.well-known`.
 */
export async function serveApprovalCallback(
  scope: ScopeEntry,
  path: string,
  handler: ApprovalCallbackHandler,
): Promise<void> {
  if (mcpPaths(scope).includes(path) || /^\/(oauth|\.well-known)(\/|$)/.test(path)) {
    throw new ApprovalConfigurationError(
      `ApprovalPlugin \`webhook.callbackPath\` ${path} is a path the server reserves`,
    );
  }
  let routes = callbackRoutes.get(scope);
  const firstRoute = !routes;
  routes ??= new Map();
  if (routes.has(path)) {
    throw new ApprovalConfigurationError(
      `ApprovalPlugin \`webhook.callbackPath\` ${path} is served by another ApprovalPlugin; give each its own`,
    );
  }
  routes.set(path, handler);
  callbackRoutes.set(scope, routes);
  if (firstRoute) await scope.registryFlows(ApprovalCallbackFlow);
}
