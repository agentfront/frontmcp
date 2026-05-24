import { registerMetricsRoutes, type MetricsResponseLike, type MetricsRouteServer } from '../metrics.routes';
import { MetricsService } from '../metrics.service';

class FakeResponse implements MetricsResponseLike {
  statusCode = 0;
  headers: Record<string, string> = {};
  body: unknown = undefined;
  sentBodyString?: string;

  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  send(payload: string) {
    this.sentBodyString = payload;
    return this;
  }
  json(payload: unknown) {
    this.body = payload;
  }
}

function makeServer() {
  const routes: Array<{ method: string; path: string; handler: (req: unknown, res: FakeResponse) => unknown }> = [];
  const server: MetricsRouteServer = {
    registerRoute(method, path, handler) {
      routes.push({ method, path, handler: handler as (req: unknown, res: FakeResponse) => unknown });
    },
  };
  return { server, routes };
}

describe('registerMetricsRoutes (issue #397)', () => {
  it('does not register a route when config.enabled !== true', () => {
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true }, undefined, { snapshotSource: () => [] });
    registerMetricsRoutes(server, service, { enabled: false });
    expect(routes).toHaveLength(0);
  });

  it("registers GET <path> when enabled: true (default '/metrics')", () => {
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true }, undefined, { snapshotSource: () => [] });
    registerMetricsRoutes(server, service, { enabled: true });
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe('GET');
    expect(routes[0].path).toBe('/metrics');
  });

  it('honors a custom path', () => {
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true, path: '/internal/m' }, undefined, {
      snapshotSource: () => [],
    });
    registerMetricsRoutes(server, service, { enabled: true, path: '/internal/m' });
    expect(routes[0].path).toBe('/internal/m');
  });

  it("returns 200 and Prometheus body with auth='public'", async () => {
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true }, undefined, {
      snapshotSource: () => [{ name: 'requests_total', count: 1, attributes: {} }],
    });
    registerMetricsRoutes(server, service, { enabled: true });

    const res = new FakeResponse();
    await routes[0].handler({ headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.sentBodyString).toContain('requests_total 1');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8');
  });

  it("returns 401 when auth='token' and no Authorization header is sent", async () => {
    process.env['FRONTMCP_METRICS_TOKEN'] = 'sekret';
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true, auth: 'token' }, undefined, {
      snapshotSource: () => [],
    });
    registerMetricsRoutes(server, service, { enabled: true, auth: 'token' });

    const res = new FakeResponse();
    await routes[0].handler({ headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it("returns 403 when auth='token' and a wrong bearer is sent", async () => {
    process.env['FRONTMCP_METRICS_TOKEN'] = 'sekret';
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true, auth: 'token' }, undefined, {
      snapshotSource: () => [],
    });
    registerMetricsRoutes(server, service, { enabled: true, auth: 'token' });

    const res = new FakeResponse();
    await routes[0].handler({ headers: { authorization: 'Bearer wrong' } }, res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
  });

  it("returns 200 and body when auth='token' and the correct bearer is sent", async () => {
    process.env['FRONTMCP_METRICS_TOKEN'] = 'sekret';
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true, auth: 'token' }, undefined, {
      snapshotSource: () => [{ name: 'ok_total', count: 1, attributes: {} }],
    });
    registerMetricsRoutes(server, service, { enabled: true, auth: 'token' });

    const res = new FakeResponse();
    await routes[0].handler({ headers: { authorization: 'Bearer sekret' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.sentBodyString).toContain('ok_total 1');
  });

  it("returns JSON body when format='json'", async () => {
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true, format: 'json' }, undefined, {
      snapshotSource: () => [{ name: 'foo_total', count: 1, attributes: {} }],
    });
    registerMetricsRoutes(server, service, { enabled: true, format: 'json' });

    const res = new FakeResponse();
    await routes[0].handler({ headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ counters: [{ name: 'foo_total', count: 1 }] });
  });

  it('returns 500 (not silent text-wrapped JSON) when the adapter lacks res.send for Prometheus output', async () => {
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true }, undefined, {
      snapshotSource: () => [{ name: 'foo_total', count: 1, attributes: {} }],
    });
    registerMetricsRoutes(server, service, { enabled: true });

    // Strip `send` to simulate an adapter that only exposes `json`. We MUST
    // NOT wrap Prometheus plaintext in a JSON envelope — scrapers would
    // silently start parsing JSON-as-text and report no metrics. The route
    // surfaces the adapter mismatch as a 500 instead.
    const res = new FakeResponse();
    (res as unknown as { send?: undefined }).send = undefined;
    await routes[0].handler({ headers: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'internal_error' });
  });

  it('returns 500 instead of throwing when the JSON body is unparseable', async () => {
    const { server, routes } = makeServer();
    const service = new MetricsService({ enabled: true, format: 'json' }, undefined, {
      snapshotSource: () => [{ name: 'foo_total', count: 1, attributes: {} }],
    });
    // Stub getMetrics so the body returned is malformed JSON — defends
    // the route handler against a future downstream override producing
    // bad output (the production `getMetrics` always emits valid JSON
    // via `JSON.stringify`).
    jest.spyOn(service, 'getMetrics').mockReturnValue({
      contentType: 'application/json',
      body: '{not-valid-json',
    });
    registerMetricsRoutes(server, service, { enabled: true, format: 'json' });

    const res = new FakeResponse();
    await routes[0].handler({ headers: {} }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ error: 'internal_error' });
  });
});
