// file: plugins/plugin-skilled-openapi/src/executor/caller-token.ts
//
// The MCP client's own token, for bearer bindings with `passthroughCallerToken: true`.
//
// The token is forwarded to the upstream API only when it was issued for that API: a token the
// client obtained for this MCP server, sent on to another service, is the confused-deputy "token
// passthrough" the MCP authorization spec forbids.

import { decodeJwtPayloadSafe } from '@frontmcp/auth';
import { trimTrailing } from '@frontmcp/utils';

/** The bearer token the MCP client presented to this server (`authInfo.token`), when it presented one. */
export function callerTokenOf(authInfo: unknown): string | undefined {
  if (typeof authInfo !== 'object' || authInfo === null) return undefined;
  const token = (authInfo as { token?: unknown }).token;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/**
 * Why the caller's token may not be forwarded to the service at `baseUrl`, or `undefined` when it
 * may. It may when it is a JWT whose `resource` claim (RFC 8707) or `aud` claim (where RFC 8707 /
 * RFC 9068 put the resource indicator) names the service: its base URL, or a URL above it on the
 * same origin.
 */
export function callerTokenRefusal(token: string, baseUrl: string): string | undefined {
  const claims = decodeJwtPayloadSafe(token);
  if (!claims) {
    return 'the caller token is not a JWT, so the API it was issued for cannot be checked';
  }
  const issuedFor = [...claimValues(claims['resource']), ...claimValues(claims['aud'])];
  if (issuedFor.some((resource) => resourceCovers(resource, baseUrl))) return undefined;
  return `the caller token was not issued for ${baseUrl} (no resource or aud claim names it)`;
}

function claimValues(claim: unknown): string[] {
  if (typeof claim === 'string') return [claim];
  if (Array.isArray(claim)) return claim.filter((value): value is string => typeof value === 'string');
  return [];
}

/** Whether the resource indicator `resource` covers the API at `baseUrl`. */
function resourceCovers(resource: string, baseUrl: string): boolean {
  let issued: URL;
  let target: URL;
  try {
    issued = new URL(resource);
    target = new URL(baseUrl);
  } catch {
    return false;
  }
  // A resource with a query or fragment names something narrower than an API; never treat it as one.
  if (issued.search || issued.hash || issued.origin !== target.origin) return false;
  const issuedPath = trimTrailing(issued.pathname, '/');
  const targetPath = trimTrailing(target.pathname, '/');
  return issuedPath === '' || targetPath === issuedPath || targetPath.startsWith(`${issuedPath}/`);
}
