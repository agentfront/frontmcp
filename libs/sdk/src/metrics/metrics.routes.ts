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
  const path = config.path ?? '/metrics';

  server.registerRoute('GET', path, async (req, res) => {
    const status = service.authorize(readAuthorizationHeader(req.headers));
    if (status !== 200) {
      res.setHeader?.('Cache-Control', 'no-store');
      res.status(status).json({
        error: status === 401 ? 'unauthorized' : 'forbidden',
        message:
          status === 401
            ? 'Missing or malformed Authorization header'
            : 'Bearer token did not match the configured metrics token',
      });
      return;
    }

    const result = service.getMetrics();
    res.setHeader?.('Cache-Control', 'no-store');
    res.setHeader?.('Content-Type', result.contentType);

    if ((config.format ?? 'prometheus') === 'json') {
      res.status(200).json(JSON.parse(result.body));
      return;
    }
    if (typeof res.send === 'function') {
      res.status(200);
      res.send(result.body);
      return;
    }
    res.status(200).json({ body: result.body });
  });
}
