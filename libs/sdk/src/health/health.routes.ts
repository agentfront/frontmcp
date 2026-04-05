/**
 * @file health.routes.ts
 * @description HTTP route registration for health and readiness endpoints.
 */

import { getRuntimeContext } from '@frontmcp/utils';
import type { HealthOptionsInterface } from '../common';
import type { HealthService } from './health.service';

/**
 * Minimal server interface for route registration.
 * Avoids importing the full FrontMcpServerInstance to prevent circular dependencies.
 */
export interface HealthRouteServer {
  registerRoute(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD',
    path: string,
    handler: (req: unknown, res: { status(code: number): { json(payload: unknown): void } }) => Promise<void> | void,
  ): void;
}

/**
 * Determine if the readyz endpoint should be enabled based on runtime.
 *
 * Auto-detection rules (when readyz.enabled is not explicitly set):
 * - Edge/Cloudflare/Vercel (serverless): disabled (no persistent connections)
 * - Node.js, Bun, Deno, Browser: enabled
 */
export function isReadyzEnabled(config: HealthOptionsInterface): boolean {
  if (config.readyz?.enabled !== undefined) {
    return config.readyz.enabled;
  }
  const ctx = getRuntimeContext();
  return ctx.runtime !== 'edge' && ctx.deployment !== 'serverless';
}

/**
 * Register health and readiness HTTP routes on the server.
 *
 * Registers:
 * - `GET /healthz` (or custom path) — liveness probe
 * - `GET /readyz` (or custom path) — readiness probe (runtime-conditional)
 * - `GET /health` — legacy alias for /healthz (backwards compatibility)
 */
export function registerHealthRoutes(
  server: HealthRouteServer,
  healthService: HealthService,
  config: HealthOptionsInterface,
): void {
  const healthzPath = config.healthzPath ?? '/healthz';
  const readyzPath = config.readyzPath ?? '/readyz';

  // Liveness probe
  server.registerRoute('GET', healthzPath, async (_req, res) => {
    const response = healthService.getHealthz();
    res.status(response.status === 'ok' ? 200 : 503).json(response);
  });

  // Legacy /health alias (backwards compatibility)
  if (healthzPath !== '/health') {
    server.registerRoute('GET', '/health', async (_req, res) => {
      const response = healthService.getHealthz();
      res.status(response.status === 'ok' ? 200 : 503).json(response);
    });
  }

  // Readiness probe (runtime-conditional)
  if (isReadyzEnabled(config)) {
    server.registerRoute('GET', readyzPath, async (_req, res) => {
      const response = await healthService.getReadyz();
      res.status(response.status === 'ready' ? 200 : 503).json(response);
    });
  }
}
