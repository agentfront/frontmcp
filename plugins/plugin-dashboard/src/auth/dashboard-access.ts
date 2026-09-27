import { MCP_ERROR_CODES, PublicMcpError, type ToolContext } from '@frontmcp/sdk';

import { resolveDashboardOptions } from '../dashboard.config-store';
import { DashboardConfigToken } from '../dashboard.symbol';
import { isDashboardEnabled, type DashboardPluginOptions } from '../dashboard.types';
import { DASHBOARD_TOKEN_HEADER, tokenMatches } from './dashboard-auth';

/**
 * Set on a request's `FrontMcpContext` by the dashboard's HTTP gate once the request has
 * shown the dashboard token. Module-private, so only the gate can set it.
 */
const GATE_PASSED = Symbol('frontmcp:dashboard:gate-passed');

/** Context methods the gate marker needs (a `FrontMcpContext`). */
interface ContextStore {
  set<T>(key: symbol, value: T): void;
  get<T>(key: symbol): T | undefined;
}

/** Record that the HTTP gate checked this request's dashboard token. */
export function markDashboardGatePassed(ctx: ContextStore | undefined): void {
  ctx?.set(GATE_PASSED, true);
}

/** The dashboard is turned off (`enabled: false`, or the production default): its MCP endpoint and tools refuse. */
export class DashboardDisabledError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.FORBIDDEN;

  constructor() {
    super('The FrontMCP dashboard is disabled.', 'DASHBOARD_DISABLED', 404);
  }
}

/** `auth` is on and the caller has not shown the dashboard token. */
export class DashboardUnauthorizedError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.UNAUTHORIZED;

  constructor() {
    super(
      `The dashboard token is required. Send it in the ${DASHBOARD_TOKEN_HEADER} header.`,
      'DASHBOARD_UNAUTHORIZED',
      401,
      'Bearer realm="frontmcp-dashboard"',
    );
  }
}

/**
 * Refuse a dashboard tool call that the dashboard's own options don't allow.
 *
 * The HTTP gate (a hook on the dashboard scope's `http:request` flow) already refuses such
 * requests; this check makes the tools refuse them wherever they are served from (a
 * direct or stdio server, another app they were added to), so `enabled` and `auth` hold
 * for every transport, not only for the web page.
 *
 * @param options - the dashboard's effective options
 * @param ctx - the request's context: the gate's mark, and its `x-frontmcp-*` headers
 */
export function assertDashboardAccess(
  options: DashboardPluginOptions,
  ctx: (ContextStore & { metadata?: { customHeaders?: Readonly<Record<string, string>> } }) | undefined,
): void {
  if (!isDashboardEnabled(options)) {
    throw new DashboardDisabledError();
  }
  if (!options.auth?.enabled) return;

  if (ctx?.get<boolean>(GATE_PASSED) === true) return;

  const expected = options.auth.token;
  const presented = ctx?.metadata?.customHeaders?.[DASHBOARD_TOKEN_HEADER];
  if (expected && presented && tokenMatches(presented, expected)) return;

  throw new DashboardUnauthorizedError();
}

/**
 * {@link assertDashboardAccess} for one of the dashboard's tools: the options come from the
 * dashboard's config provider (the ones its HTTP gate uses), else the published options.
 */
export function assertDashboardToolAccess(tool: ToolContext): void {
  const configured = tool.tryGet(DashboardConfigToken) as DashboardPluginOptions | undefined;
  assertDashboardAccess(configured ?? resolveDashboardOptions(), tool.tryGetContext());
}
