/**
 * Host Header Validation Middleware
 *
 * Express-side adapter over the transport-agnostic rules in
 * `../security/host-validation`. The rules live there so the web-fetch
 * (Worker/edge) handler applies exactly the same checks — two adapters must
 * never diverge in behavior (.claude/rules/flow-architecture.md).
 *
 * Enabled by DEFAULT since v1.7.2 (BC-035, GHSA-mc9g-v2cp-vfff); the adapter
 * decides whether to install it.
 */

import type { ServerRequest, ServerResponse } from '../../common';
import { compileHostValidation, validateHostHeaders } from '../security/host-validation';

/**
 * Configuration for host validation middleware.
 */
export interface HostValidationOptions {
  /** Whether host validation is enabled. */
  enabled: boolean;
  /** Allowed Host header values (e.g., ['localhost:3001', 'api.example.com']) */
  allowedHosts?: string[];
  /** Allowed Origin header values (e.g., ['https://app.example.com']) */
  allowedOrigins?: string[];
}

/**
 * Create middleware that validates Host and Origin headers.
 * Returns a no-op middleware when not enabled.
 */
export function createHostValidationMiddleware(
  options: HostValidationOptions,
): (req: ServerRequest, res: ServerResponse, next: () => void) => void {
  if (!options.enabled) {
    return (_req, _res, next) => next();
  }

  const compiled = compileHostValidation({
    allowedHosts: options.allowedHosts,
    allowedOrigins: options.allowedOrigins,
  });

  return (req, res, next) => {
    const rejection = validateHostHeaders(
      {
        host: req.headers?.['host'] as string | undefined,
        forwardedHost: req.headers?.['x-forwarded-host'] as string | undefined,
        origin: req.headers?.['origin'] as string | undefined,
      },
      compiled,
    );

    if (rejection) {
      res.status(rejection.status).json({ error: rejection.error, message: rejection.message });
      return;
    }

    next();
  };
}
