/**
 * @file metrics.routes.ts
 * @description HTTP route registration for the `/metrics` endpoint (issue #397).
 */

import type { MetricsOptionsInterface } from '../common';
import type { MetricsService } from './metrics.service';

/**
 * Minimal server interface for route registration. Mirrors `HealthRouteServer`
 * to avoid importing the full `FrontMcpServerInstance` (circular dependencies).
 */
export interface MetricsRouteServer {
  registerRoute(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD',
    path: string,
    handler: (
      req: { headers?: Record<string, string | string[] | undefined> },
      res: MetricsResponseLike,
    ) => Promise<void> | void,
  ): void;
}

/** Subset of the Express-style response object the route uses. */
export interface MetricsResponseLike {
  status(code: number): MetricsResponseLike;
  setHeader?(name: string, value: string): MetricsResponseLike | void;
  type?(contentType: string): MetricsResponseLike;
  send?(body: string): MetricsResponseLike | void;
  json(payload: unknown): void;
}

function readAuthorizationHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | undefined {
  if (!headers) return undefined;
  const raw = headers['authorization'] ?? headers['Authorization'];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * One scrape of the metrics endpoint, independent of the HTTP server that
 * sends it — the Express route and the web-fetch handler render the same
 * result, so the two transports cannot answer `/metrics` differently.
 */
export type MetricsHttpResult =
  | { status: number; headers: Record<string, string>; kind: 'json'; body: unknown }
  | { status: number; headers: Record<string, string>; kind: 'text'; body: string };

/** The metrics endpoint's path (`metrics.path`, default `/metrics`). */
export function metricsPath(config: MetricsOptionsInterface): string {
  return config.path ?? '/metrics';
}

/**
 * Answer one `GET <path>` scrape: check the `Authorization` header against the
 * configured policy, then render the metrics in the configured format.
 */
export function renderMetricsScrape(
  service: MetricsService,
  config: MetricsOptionsInterface,
  authorizationHeader: string | undefined,
): MetricsHttpResult {
  const status = service.authorize(authorizationHeader);
  if (status !== 200) {
    return {
      status,
      headers: { 'Cache-Control': 'no-store' },
      kind: 'json',
      body: {
        error: status === 401 ? 'unauthorized' : 'forbidden',
        message:
          status === 401
            ? 'Missing or malformed Authorization header'
            : 'Bearer token did not match the configured metrics token',
      },
    };
  }

  const result = service.getMetrics();
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': result.contentType };
  if ((config.format ?? 'prometheus') !== 'json') {
    return { status: 200, headers, kind: 'text', body: result.body };
  }
  try {
    return { status: 200, headers, kind: 'json', body: JSON.parse(result.body) };
  } catch {
    // `getMetrics()` builds the JSON via `JSON.stringify`, so this
    // branch should be unreachable — but if a downstream override
    // produces malformed JSON we surface a 500 rather than letting
    // the parse exception escape the route handler.
    return {
      status: 500,
      headers,
      kind: 'json',
      body: { error: 'internal_error', message: 'Failed to serialise metrics JSON' },
    };
  }
}

/**
 * Register the `GET <path>` metrics endpoint. No-op when the config has
 * `enabled !== true` — callers should already have gated this call but the
 * extra guard keeps `prepare()` simple.
 */
export function registerMetricsRoutes(
  server: MetricsRouteServer,
  service: MetricsService,
  config: MetricsOptionsInterface,
): void {
  if (config.enabled !== true) return;

  server.registerRoute('GET', metricsPath(config), async (req, res) => {
    const result = renderMetricsScrape(service, config, readAuthorizationHeader(req.headers));
    for (const [name, value] of Object.entries(result.headers)) res.setHeader?.(name, value);

    if (result.kind === 'json') {
      res.status(result.status).json(result.body);
      return;
    }
    if (typeof res.send === 'function') {
      res.status(result.status);
      res.send(result.body);
      return;
    }
    // Prometheus scrape format is `text/plain` — wrapping it in JSON
    // would silently break every scraper. Surface a 500 instead so the
    // adapter mismatch is visible.
    res.status(500).json({
      error: 'internal_error',
      message: 'Server adapter does not support Prometheus text format. Use `format: "json"` or upgrade the adapter.',
    });
  });
}
