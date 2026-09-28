/**
 * Which of the scopes a client asked for an authorization server may grant.
 *
 * RFC 6749 §3.3 lets the server issue fewer scopes than requested (and requires
 * it to say so in the token response's `scope`). FrontMCP grants only what the
 * operator allows, so a client can't award itself a scope such as `admin`.
 */
import { globMatch } from '../authorization/dcr-client.registry';

/** The scopes granted when `allowedScopes` is not configured: the standard OpenID Connect ones. */
export const DEFAULT_ALLOWED_SCOPES: readonly string[] = Object.freeze([
  'openid',
  'profile',
  'email',
  'offline_access',
]);

/**
 * Keep the requested scopes that match an allowed entry (exact, or a `*` glob),
 * in request order, without duplicates.
 *
 * @param requested The scopes the client asked for.
 * @param allowed   The configured allowlist; `undefined` means {@link DEFAULT_ALLOWED_SCOPES}.
 */
export function grantScopes(requested: readonly string[], allowed: readonly string[] | undefined): string[] {
  const patterns = allowed ?? DEFAULT_ALLOWED_SCOPES;
  const granted: string[] = [];
  for (const scope of requested) {
    if (!scope || granted.includes(scope)) continue;
    if (patterns.some((pattern) => globMatch(pattern, scope))) granted.push(scope);
  }
  return granted;
}

/**
 * The scope values to advertise as `scopes_supported` (RFC 8414 §2, RFC 9728 §2)
 * for a server that grants `allowed`: the literal entries, in order, without
 * duplicates. A `*` glob such as `'tickets:*'` names no single scope a client
 * could ask for, so it isn't advertised (RFC 8414 lets a server leave supported
 * scopes out); list a scope literally to advertise it.
 *
 * @param allowed The configured allowlist; `undefined` means {@link DEFAULT_ALLOWED_SCOPES}.
 */
export function advertisedScopes(allowed: readonly string[] | undefined): string[] {
  const scopes: string[] = [];
  for (const scope of allowed ?? DEFAULT_ALLOWED_SCOPES) {
    if (scope && !scope.includes('*') && !scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}
