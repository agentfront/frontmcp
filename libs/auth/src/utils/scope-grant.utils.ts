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

/** The auth option fields {@link resourceScopesFor} reads, whichever mode they belong to. */
export interface ResourceScopeOptions {
  mode?: string;
  allowedScopes?: readonly string[];
  anonymousScopes?: readonly string[];
  scopes?: readonly string[];
  requiredScopes?: readonly string[];
}

/**
 * The scope values a protected resource advertises as `scopes_supported`
 * (RFC 9728 §2) for its auth mode: the scopes a client can actually be given
 * for it, not a fixed OpenID Connect list (#629).
 *
 * - `local` / `remote`: the literal entries of `allowedScopes` ({@link advertisedScopes});
 * - `public` (and no auth at all): `anonymousScopes`, what the anonymous grant gives;
 * - `static`: `scopes`, what the static credential carries;
 * - `transparent`: `requiredScopes`, then `scopes` (what the upstream provider is
 *   asked for), the scopes a token for this resource needs.
 *
 * An empty result means the server names no scopes; leave `scopes_supported` out then.
 *
 * @param options The scope's auth options (parsed or as configured); `undefined` means public mode.
 */
export function resourceScopesFor(options: ResourceScopeOptions | undefined): string[] {
  const mode = options?.mode ?? 'public';
  if (mode === 'local' || mode === 'remote') return advertisedScopes(options?.allowedScopes);
  const listed =
    mode === 'public'
      ? (options?.anonymousScopes ?? ['anonymous'])
      : mode === 'static'
        ? (options?.scopes ?? ['static'])
        : mode === 'transparent'
          ? [...(options?.requiredScopes ?? []), ...(options?.scopes ?? [])]
          : [];
  return advertisedScopes(listed);
}
