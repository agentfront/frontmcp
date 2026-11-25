/**
 * The audience a transparent-mode token must name, from the server's configuration only (#1393).
 */

import { deriveExpectedAudience } from '@frontmcp/auth';
import { getNodeEnv } from '@frontmcp/utils';

import { defaultHttpPort, isPublicUrlPinned, normalizeEntryPrefix, type ScopeEntry } from '../common';
import { normalizeHost } from '../server/security/host-validation';
import { allowedHostsFromEnv, LOOPBACK_NAMES } from '../server/security/resolve-allowed-hosts';

/** The audience settings of transparent auth. */
export interface TransparentAudienceOptions {
  expectedAudience?: string | string[];
  audienceFromRequestHost?: boolean;
}

/** The hosts DNS-rebinding protection checks the request host against: none while it is off. */
export function checkedAllowedHosts(scope: ScopeEntry): string[] | undefined {
  const protection = scope.metadata.http?.security?.dnsRebindingProtection;
  return protection?.enabled === false ? undefined : (protection?.allowedHosts ?? allowedHostsFromEnv());
}

/** Whether a server with no configured audience accepts its loopback address: only in development and tests. */
export function acceptsLoopbackAudience(): boolean {
  let nodeEnv: string | undefined;
  try {
    nodeEnv = getNodeEnv();
  } catch {
    return false;
  }
  return nodeEnv === 'development' || nodeEnv === 'test';
}

/**
 * The audiences a transparent-mode token must name: `expectedAudience`; else the server's address, from the pinned
 * `FRONTMCP_PUBLIC_URL`, a request host listed in the allowed hosts, or, with `audienceFromRequestHost`, any request
 * host; else, in development and tests, its loopback address on `http.port`. None otherwise, which refuses every
 * token that names an audience.
 */
export function transparentTokenAudiences(
  options: TransparentAudienceOptions,
  requestBaseUrl: string,
  scope: ScopeEntry,
): string[] {
  const configured = options.expectedAudience;
  if (configured) {
    return Array.isArray(configured) ? configured : [configured];
  }
  if (isPublicUrlPinned() || options.audienceFromRequestHost || isAllowedHost(requestBaseUrl, scope)) {
    return deriveExpectedAudience(requestBaseUrl);
  }
  if (!acceptsLoopbackAudience()) {
    return [];
  }
  const port = scope.metadata.http?.port ?? defaultHttpPort();
  const entryPath = normalizeEntryPrefix(scope.entryPath);
  return LOOPBACK_NAMES.flatMap((host) => deriveExpectedAudience(`http://${host}:${port}${entryPath}`));
}

/** Whether the host of `requestBaseUrl` is one of the allowed hosts. */
function isAllowedHost(requestBaseUrl: string, scope: ScopeEntry): boolean {
  const allowedHosts = checkedAllowedHosts(scope);
  if (!allowedHosts?.length) {
    return false;
  }
  let requestHost: string;
  try {
    requestHost = normalizeHost(new URL(requestBaseUrl).host);
  } catch {
    return false;
  }
  return allowedHosts.some((allowedHost) => normalizeHost(allowedHost) === requestHost);
}
