/**
 * The dashboard tools' own check, which holds where no HTTP request passes the gate
 * (a direct or stdio server, or the tools added to another app).
 */
import {
  assertDashboardAccess,
  DashboardDisabledError,
  DashboardUnauthorizedError,
  markDashboardGatePassed,
} from '../auth/dashboard-access';
import { DASHBOARD_TOKEN_HEADER } from '../auth/dashboard-auth';
import { dashboardPluginOptionsSchema } from '../dashboard.types';

const TOKEN = 'tool-level-token';

function context(customHeaders: Record<string, string> = {}) {
  const store = new Map<symbol, unknown>();
  return {
    metadata: { customHeaders },
    set: <T>(key: symbol, value: T) => void store.set(key, value),
    get: <T>(key: symbol) => store.get(key) as T | undefined,
  };
}

describe('assertDashboardAccess', () => {
  const previous = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = previous;
  });

  it('refuses when the dashboard is disabled', () => {
    const options = dashboardPluginOptionsSchema.parse({ enabled: false });
    expect(() => assertDashboardAccess(options, context())).toThrow(DashboardDisabledError);
  });

  it('refuses under the production default', () => {
    process.env['NODE_ENV'] = 'production';
    const options = dashboardPluginOptionsSchema.parse({});
    expect(() => assertDashboardAccess(options, context())).toThrow(DashboardDisabledError);
  });

  it('allows an enabled dashboard without auth', () => {
    const options = dashboardPluginOptionsSchema.parse({ enabled: true });
    expect(() => assertDashboardAccess(options, undefined)).not.toThrow();
  });

  describe('with auth', () => {
    const options = dashboardPluginOptionsSchema.parse({ enabled: true, auth: { enabled: true, token: TOKEN } });

    it('refuses a call with no context or token', () => {
      expect(() => assertDashboardAccess(options, undefined)).toThrow(DashboardUnauthorizedError);
      expect(() => assertDashboardAccess(options, context())).toThrow(DashboardUnauthorizedError);
    });

    it('refuses a wrong header token', () => {
      expect(() => assertDashboardAccess(options, context({ [DASHBOARD_TOKEN_HEADER]: 'nope' }))).toThrow(
        DashboardUnauthorizedError,
      );
    });

    it('accepts the token in the x-frontmcp-dashboard-token header', () => {
      expect(() => assertDashboardAccess(options, context({ [DASHBOARD_TOKEN_HEADER]: TOKEN }))).not.toThrow();
    });

    it('accepts a request the HTTP gate marked', () => {
      const ctx = context();
      markDashboardGatePassed(ctx);
      expect(() => assertDashboardAccess(options, ctx)).not.toThrow();
    });

    it('does not accept a mark set under another key', () => {
      const ctx = context();
      ctx.set(Symbol('frontmcp:dashboard:gate-passed'), true);
      expect(() => assertDashboardAccess(options, ctx)).toThrow(DashboardUnauthorizedError);
    });
  });

  it('answers the client with 401 and a challenge', () => {
    const error = new DashboardUnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('DASHBOARD_UNAUTHORIZED');
    expect(error.wwwAuthenticate).toContain('frontmcp-dashboard');
  });
});
