import { getEnv } from '@frontmcp/utils';

import { normalizeEntryPrefix, normalizeScopeBase, type ScopeEntry } from '../common';
import { DEFAULT_REGISTRY_PUBLIC_KEY_ENV, toRegistryAuthRecord } from '../common/types/options/registry';

export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';

const envVarsReportedInvalid = new Set<string>();

/** Read per request: a Worker's env reaches `process.env` only with its first request. */
export function resolveRegistryAuthRecord(scope: Pick<ScopeEntry, 'metadata' | 'logger'>): string | undefined {
  const registry = scope.metadata.registry;
  if (!registry) return undefined;
  if (registry.publicKey) return toRegistryAuthRecord(registry.publicKey);

  const envName = registry.publicKeyEnv ?? DEFAULT_REGISTRY_PUBLIC_KEY_ENV;
  const configuredKey = getEnv(envName)?.trim();
  if (!configuredKey) return undefined;

  const record = toRegistryAuthRecord(configuredKey);
  if (!record && !envVarsReportedInvalid.has(envName)) {
    envVarsReportedInvalid.add(envName);
    scope.logger.warn(
      `MCP Registry domain proof not served: ${envName} is neither a base64 Ed25519 public key nor a "v=MCPv1; k=...; p=..." record`,
    );
  }
  return record;
}

export function mcpEndpointPath(scope: Pick<ScopeEntry, 'entryPath' | 'routeBase'>): string {
  return `${normalizeEntryPrefix(scope.entryPath)}${normalizeScopeBase(scope.routeBase)}`;
}

export function serverCardPath(scope: Pick<ScopeEntry, 'entryPath' | 'routeBase'>): string {
  return `${mcpEndpointPath(scope)}/server-card`;
}
