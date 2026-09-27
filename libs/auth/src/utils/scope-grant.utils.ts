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
