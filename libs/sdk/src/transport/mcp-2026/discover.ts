/**
 * `server/discover` — protocol 2026-07-28, SEP-2575.
 *
 * Servers MUST implement this RPC. It advertises the versions the server
 * speaks, its capabilities, and its instructions — the payload `initialize`
 * used to return, minus everything that only made sense for a session.
 *
 * Clients MAY skip it entirely and negotiate inline via per-request `_meta`,
 * which is why it must be cheap and side-effect free.
 */
import { type DiscoverResult, type ServerCapabilities2026 } from '@frontmcp/protocol';

import { type Scope } from '../../scope';
import { buildScopedServerOptions } from '../build-scoped-server-options';
import { ADVERTISED_EXTENSIONS, SUPPORTED_PROTOCOL_VERSIONS_2026 } from './protocol-2026.constants';

/**
 * Project the scope's capability set into the 2026-07-28 shape.
 *
 * The only structural change is `extensions`: this revision promotes optional
 * MCP extensions out of `experimental` into a first-class field, so anything
 * the scope already advertises is merged with the server-level extension list.
 */
export function buildDiscoverCapabilities(scope: Scope): ServerCapabilities2026 {
  const { capabilities } = buildScopedServerOptions(scope);
  const source = capabilities as Record<string, unknown>;

  const extensions: Record<string, Record<string, unknown>> = {
    ...ADVERTISED_EXTENSIONS,
    ...((source['extensions'] as Record<string, Record<string, unknown>> | undefined) ?? {}),
  };

  const result: ServerCapabilities2026 = { extensions };

  if (source['experimental']) result.experimental = source['experimental'] as Record<string, Record<string, unknown>>;
  if (source['logging']) result.logging = source['logging'] as Record<string, unknown>;
  if (source['completions']) result.completions = source['completions'] as Record<string, unknown>;
  if (source['prompts']) result.prompts = source['prompts'] as { listChanged?: boolean };
  if (source['resources']) result.resources = source['resources'] as { subscribe?: boolean; listChanged?: boolean };
  if (source['tools']) result.tools = source['tools'] as { listChanged?: boolean };

  return result;
}

/**
 * Build the `server/discover` result body.
 *
 * `resultType`, `_meta.serverInfo`, `ttlMs` and `cacheScope` are added by the
 * shared result decorator, so this returns only the method-specific fields.
 */
export function buildDiscoverResult(scope: Scope, instructions?: string): Omit<DiscoverResult, keyof object> {
  const capabilities = buildDiscoverCapabilities(scope);

  return {
    supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS_2026],
    capabilities,
    ...(instructions ? { instructions } : {}),
  } as Omit<DiscoverResult, keyof object>;
}
