/**
 * Host Header Validation Middleware
 *
 * Validates the HTTP Host header against a whitelist of allowed values
 * to protect against DNS rebinding attacks. Only active when explicitly
 * enabled via security.dnsRebindingProtection.enabled = true.
 */

import type { ServerRequest, ServerResponse } from '../../common';

/**
 * Configuration for host validation middleware.
 */
export interface HostValidationOptions {
  /** Whether host validation is enabled. @default false */
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

  const allowedHostsSet = options.allowedHosts ? new Set(options.allowedHosts) : undefined;
  const allowedOriginsSet = options.allowedOrigins ? new Set(options.allowedOrigins) : undefined;

  return (req, res, next) => {
    // Validate Host header
    if (allowedHostsSet) {
      const host = req.headers?.['host'];
      if (!host || !allowedHostsSet.has(host as string)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Invalid Host header',
        });
        return;
      }
    }

    // Validate Origin header (only if present and allowedOrigins configured)
    if (allowedOriginsSet) {
      const origin = req.headers?.['origin'] as string | undefined;
      if (origin && !allowedOriginsSet.has(origin)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Invalid Origin header',
        });
        return;
      }
    }

    next();
  };
}
