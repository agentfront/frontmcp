// file: libs/sdk/src/front-mcp/session-secret.check.ts

import { isSessionSecretConfigured, SessionSecretRequiredError } from '@frontmcp/auth';
import { isProduction } from '@frontmcp/utils';

import { type FrontMcpConfigType } from '../common';
import type { HealthProbeDefinition } from '../common/types/options/health';

/** What a request that names no MCP revision gets: the session pipeline (`'legacy'`) or stateless MCP 2026-07-28. */
export type ProtocolFallback = 'legacy' | '2026-07-28';

export const MISSING_SESSION_SECRET_WARNING =
  'MCP_SESSION_SECRET is not set: clients before MCP 2026-07-28 get 500 SESSION_SECRET_REQUIRED on initialize, ' +
  'while clients on MCP 2026-07-28 are served. Set MCP_SESSION_SECRET (openssl rand -hex 32).';

/** The `/readyz` check of a server that starts without `MCP_SESSION_SECRET`: degraded, so the server stays ready. */
export const missingSessionSecretProbe: HealthProbeDefinition = {
  name: 'session-secret',
  check: async () => ({ status: 'degraded', error: MISSING_SESSION_SECRET_WARNING }),
};

/**
 * In production the session ids of MCP clients before 2026-07-28 are encrypted with `MCP_SESSION_SECRET`. A server
 * that serves MCP over HTTP and falls back to the session pipeline needs it for every client that doesn't name
 * 2026-07-28, so it refuses to start without it. A server that falls back to 2026-07-28 starts: only clients that
 * name an older revision need the secret.
 *
 * @param entryFallback The entry point's fallback when `transport.defaultProtocolVersion` is unset.
 * @returns Whether the secret is missing from a production server that starts anyway, for the caller to report.
 * @throws SessionSecretRequiredError when the server falls back to the session pipeline.
 */
export function checkSessionSecret(
  config: Pick<FrontMcpConfigType, 'transport'>,
  entryFallback: ProtocolFallback,
): boolean {
  if (!isProduction() || isSessionSecretConfigured()) return false;
  if ((config.transport?.defaultProtocolVersion ?? entryFallback) === 'legacy') {
    throw new SessionSecretRequiredError(
      'the session ids of MCP clients before 2026-07-28: set MCP_SESSION_SECRET (openssl rand -hex 32), ' +
        "or, if every client uses MCP 2026-07-28, set transport.defaultProtocolVersion to '2026-07-28'",
    );
  }
  return true;
}
