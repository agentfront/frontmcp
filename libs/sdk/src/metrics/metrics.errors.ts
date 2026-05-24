// metrics/metrics.errors.ts
// Startup errors raised by the metrics service (issue #397).

import { InternalMcpError } from '../errors/mcp.error';

/**
 * Raised when `metrics.path` collides with an MCP transport route prefix
 * (`/mcp`, `/sse`, `/messages`).
 */
export class MetricsPathConflictError extends InternalMcpError {
  readonly conflictingPath: string;

  constructor(conflictingPath: string) {
    super(
      `metrics.path "${conflictingPath}" conflicts with an MCP transport route. Pick a non-MCP path (e.g. "/metrics", "/internal/metrics").`,
      'METRICS_PATH_CONFLICT',
    );
    this.conflictingPath = conflictingPath;
  }
}

/**
 * Raised when `metrics.auth === 'token'` is configured but the env var
 * named by `metrics.tokenEnv` is unset.
 */
export class MetricsTokenNotConfiguredError extends InternalMcpError {
  readonly tokenEnv: string;

  constructor(tokenEnv: string) {
    super(
      `metrics.auth is "token" but env var "${tokenEnv}" is not set. Set the env var or switch metrics.auth to "public" / { token: "..." }.`,
      'METRICS_TOKEN_NOT_CONFIGURED',
    );
    this.tokenEnv = tokenEnv;
  }
}
