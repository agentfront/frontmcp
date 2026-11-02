import { httpRespond, HttpRoute, HttpRouteContext, type HttpOutput, type ServerRequest } from '@frontmcp/sdk';

import { DashboardDisabledError } from '../auth/dashboard-access';
import {
  createDashboardAuthValidator,
  DASHBOARD_SESSION_COOKIE,
  deriveDashboardCookieValue,
} from '../auth/dashboard-auth';
import { resolveDashboardOptions } from '../dashboard.config-store';
import { isDashboardEnabled, type DashboardPluginOptions } from '../dashboard.types';
import { generateDashboardHtml } from '../html/html.generator';

type Headers = Record<string, string | string[] | undefined>;

function isHttps(request: ServerRequest): boolean {
  const socket = request.socket as { encrypted?: boolean } | undefined;
  const forwarded = request.headers['x-forwarded-proto'];
  const protocol = (request as { protocol?: string }).protocol;
  return (
    socket?.encrypted === true ||
    protocol === 'https' ||
    (typeof forwarded === 'string' && forwarded.split(',')[0]?.trim() === 'https')
  );
}

/** The page's session cookie, one per path the page and its MCP client use. */
function sessionCookies(options: DashboardPluginOptions, paths: string[], secure: boolean) {
  const token = options.auth.token;
  if (!options.auth.enabled || !token) return [];
  const value = deriveDashboardCookieValue(token);
  return paths.map((path) => ({
    name: DASHBOARD_SESSION_COOKIE,
    value,
    path,
    httpOnly: true,
    sameSite: 'strict' as const,
    secure,
  }));
}

/**
 * The dashboard page, at `basePath`. It holds no data: its client reads the inventory from the dashboard's MCP
 * endpoint, which the dashboard's `http:request` hook gates. With `auth` on, a page request that shows the token also
 * gets an HttpOnly, `SameSite=Strict` cookie, which is how the page's own MCP client (an `EventSource`, which cannot
 * send headers) authenticates without a token in a URL.
 */
@HttpRoute({ method: 'GET', path: () => resolveDashboardOptions().basePath, auth: 'public' })
export class DashboardPageRoute extends HttpRouteContext {
  handle(): HttpOutput {
    const options = resolveDashboardOptions();
    if (!isDashboardEnabled(options)) throw new DashboardDisabledError();

    const authorize = createDashboardAuthValidator(options.auth, 'page');
    const result = authorize?.({ headers: this.request.headers as Headers, query: this.request.query as Headers });
    if (result && !result.authorized) {
      return httpRespond.json(
        { error: 'Unauthorized', message: result.message ?? 'Unauthorized' },
        { status: result.status ?? 401 },
      );
    }

    const mcpPath = this.scope.fullPath;
    const cookies = sessionCookies(options, [...new Set([mcpPath, options.basePath])], isHttps(this.request));
    return { ...httpRespond.html(generateDashboardHtml(options, mcpPath)), cookies };
  }
}
