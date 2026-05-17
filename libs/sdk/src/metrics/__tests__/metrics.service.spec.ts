import { MetricsPathConflictError, MetricsTokenNotConfiguredError } from '../metrics.errors';
import { MetricsService } from '../metrics.service';

describe('MetricsService (issue #397)', () => {
  describe('path-conflict guard', () => {
    it.each(['/mcp', '/sse', '/messages', '/mcp/streamable'])(
      'throws MetricsPathConflictError when path is %s',
      (path) => {
        expect(() => new MetricsService({ enabled: true, path })).toThrow(MetricsPathConflictError);
      },
    );

    it('accepts non-MCP paths', () => {
      expect(() => new MetricsService({ enabled: true, path: '/metrics' })).not.toThrow();
      expect(() => new MetricsService({ enabled: true, path: '/internal/metrics' })).not.toThrow();
    });
  });

  describe('token auth', () => {
    const origEnv = { ...process.env };
    afterEach(() => {
      process.env = { ...origEnv };
    });

    it("throws MetricsTokenNotConfiguredError when auth='token' and env var is unset", () => {
      delete process.env['FRONTMCP_METRICS_TOKEN'];
      expect(() => new MetricsService({ enabled: true, auth: 'token' })).toThrow(MetricsTokenNotConfiguredError);
    });

    it('throws with the configured tokenEnv name when that env var is unset', () => {
      delete process.env['CUSTOM_TOKEN_ENV'];
      try {
        new MetricsService({ enabled: true, auth: 'token', tokenEnv: 'CUSTOM_TOKEN_ENV' });
        fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MetricsTokenNotConfiguredError);
        expect((err as MetricsTokenNotConfiguredError).tokenEnv).toBe('CUSTOM_TOKEN_ENV');
      }
    });

    it("succeeds when auth='token' env var is set", () => {
      process.env['FRONTMCP_METRICS_TOKEN'] = 'sekret';
      expect(() => new MetricsService({ enabled: true, auth: 'token' })).not.toThrow();
    });

    it('accepts an inline { token } literal without consulting env', () => {
      delete process.env['FRONTMCP_METRICS_TOKEN'];
      expect(() => new MetricsService({ enabled: true, auth: { token: 'inline-secret' } })).not.toThrow();
    });
  });

  describe('authorize()', () => {
    it("returns 200 for any header when auth='public'", () => {
      const service = new MetricsService({ enabled: true });
      expect(service.authorize(undefined)).toBe(200);
      expect(service.authorize('Bearer anything')).toBe(200);
    });

    it("returns 401 when auth='token' and no Authorization header is sent", () => {
      process.env['FRONTMCP_METRICS_TOKEN'] = 'sekret';
      const service = new MetricsService({ enabled: true, auth: 'token' });
      expect(service.authorize(undefined)).toBe(401);
      expect(service.authorize('NotABearer foo')).toBe(401);
    });

    it("returns 200 when the bearer token matches, 403 when it doesn't", () => {
      process.env['FRONTMCP_METRICS_TOKEN'] = 'sekret';
      const service = new MetricsService({ enabled: true, auth: 'token' });
      expect(service.authorize('Bearer sekret')).toBe(200);
      expect(service.authorize('Bearer wrong')).toBe(403);
    });

    it('accepts the inline { token } form for the same matching/mismatching behaviour', () => {
      const service = new MetricsService({ enabled: true, auth: { token: 'inline' } });
      expect(service.authorize('Bearer inline')).toBe(200);
      expect(service.authorize('Bearer other')).toBe(403);
    });
  });

  describe('getMetrics() with injected snapshotSource', () => {
    it('renders Prometheus format by default with the canonical Content-Type', () => {
      const service = new MetricsService({ enabled: true }, undefined, {
        snapshotSource: () => [{ name: 'tool_calls_total', count: 7, attributes: { tool: 'echo' } }],
      });
      const result = service.getMetrics();
      expect(result.contentType).toBe('text/plain; version=0.0.4; charset=utf-8');
      expect(result.body).toContain('# TYPE tool_calls_total counter');
      expect(result.body).toContain('tool_calls_total{tool="echo"} 7');
    });

    it("renders JSON when format='json'", () => {
      const service = new MetricsService({ enabled: true, format: 'json' }, undefined, {
        snapshotSource: () => [{ name: 'tool_calls_total', count: 1, attributes: {} }],
      });
      const result = service.getMetrics();
      expect(result.contentType).toBe('application/json');
      const parsed = JSON.parse(result.body) as { counters: Array<{ name: string; count: number }> };
      expect(parsed.counters).toEqual([{ name: 'tool_calls_total', count: 1, attributes: {} }]);
    });

    it('applies include[] filter to counters (skills only)', () => {
      const service = new MetricsService({ enabled: true, include: ['skills'] }, undefined, {
        snapshotSource: () => [
          { name: 'frontmcp_skills_bundle_pulls_total', count: 1, attributes: {} },
          { name: 'frontmcp_tool_calls_total', count: 1, attributes: {} },
          { name: 'frontmcp_http_requests_total', count: 1, attributes: {} },
        ],
      });
      const body = service.getMetrics().body;
      expect(body).toContain('frontmcp_skills_bundle_pulls_total 1');
      expect(body).not.toContain('frontmcp_tool_calls_total');
      expect(body).not.toContain('frontmcp_http_requests_total');
    });

    it("drops gauges entirely when include[] does not contain 'process'", () => {
      const service = new MetricsService(
        { enabled: true, include: ['skills'] },
        {
          collect: () => [{ name: 'frontmcp_process_uptime_seconds', value: 10 }],
          close: () => undefined,
        } as unknown as Parameters<typeof MetricsService>[1],
        { snapshotSource: () => [] },
      );
      const body = service.getMetrics().body;
      expect(body).not.toContain('frontmcp_process_uptime_seconds');
    });

    it("keeps process gauges when include[] contains 'process'", () => {
      const service = new MetricsService(
        { enabled: true, include: ['process'] },
        {
          collect: () => [{ name: 'frontmcp_process_uptime_seconds', value: 99 }],
          close: () => undefined,
        } as unknown as Parameters<typeof MetricsService>[1],
        { snapshotSource: () => [] },
      );
      const body = service.getMetrics().body;
      expect(body).toContain('frontmcp_process_uptime_seconds 99');
    });
  });
});
