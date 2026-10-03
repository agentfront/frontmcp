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
 * Why the caller's token may not be sent to `url`, or `undefined` when it may. It may when it is a
 * JWT whose `resource` claim (RFC 8707) or `aud` claim (where RFC 8707 / RFC 9068 put the resource
 * indicator) names the API `url` belongs to: that URL, or a URL above it on the same origin.
 *
 * `url` is checked as `fetch` sends it, after URL parsing resolves `.` / `..` segments (`%2e`
 * spellings and `\` separators included), so pass the URL a request actually goes to, not only the
 * service's base URL: `/v1/{id}/me` with an `id` of `..` is `/me`, outside a token issued for `/v1`.
 * A path that has a `..` segment once percent-decoded (`..%2F`, `%252e%252e`, `..;`) is refused too:
 * URL parsing keeps it inside the API, but an upstream that decodes its path before resolving it does not.
 */
export function callerTokenRefusal(token: string, url: string): string | undefined {
  const claims = decodeJwtPayloadSafe(token);
  if (!claims) {
    return 'the caller token is not a JWT, so the API it was issued for cannot be checked';
  }
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return `the caller token was not issued for ${url} (it is not a URL)`;
  }
  const destination = `${target.origin}${target.pathname}`;
  const issuedFor = [...claimValues(claims['resource']), ...claimValues(claims['aud'])];
  if (!issuedFor.some((resource) => resourceCovers(resource, target))) {
    return `the caller token was not issued for ${destination} (no resource or aud claim names it)`;
  }
  if (hasDecodedDotDotSegment(target.pathname)) {
    return `the request path ${target.pathname} has a ".." segment once percent-decoded, which could take the caller token outside the API it was issued for`;
  }
  return undefined;
}

function claimValues(claim: unknown): string[] {
  if (typeof claim === 'string') return [claim];
  if (Array.isArray(claim)) return claim.filter((value): value is string => typeof value === 'string');
  return [];
}

/** Whether the resource indicator `resource` covers `target`. */
function resourceCovers(resource: string, target: URL): boolean {
  let issued: URL;
  try {
    issued = new URL(resource);
  } catch {
    return false;
  }
  // A resource with a query or fragment names something narrower than an API; never treat it as one.
  if (issued.search || issued.hash || issued.origin !== target.origin) return false;
  const issuedPath = trimTrailing(issued.pathname, '/');
  const targetPath = trimTrailing(target.pathname, '/');
  return issuedPath === '' || targetPath === issuedPath || targetPath.startsWith(`${issuedPath}/`);
}

/** The escapes that can spell a `..` segment once decoded: `.`, `/`, `\`, `;`, and `%` (double encoding). */
const DOT_SEGMENT_ESCAPE = /%(?:2e|2f|5c|3b|25)/gi;

/**
 * Whether `pathname` has a `..` segment as an upstream that percent-decodes its path (once or
 * repeatedly) before resolving it reads it, `\` taken as a separator and `;` path parameters dropped.
 */
function hasDecodedDotDotSegment(pathname: string): boolean {
  let decoded = pathname;
  let previous: string;
  do {
    previous = decoded;
    decoded = previous.replace(DOT_SEGMENT_ESCAPE, (escape) => String.fromCharCode(parseInt(escape.slice(1), 16)));
  } while (decoded !== previous);
  return decoded.split(/[/\\]/).some((segment) => segment.split(';')[0] === '..');
}
